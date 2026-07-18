// Scheduled deletion worker.
//
// Pages Functions do not support cron triggers directly; this file is
// shaped as a standard Workers `scheduled` handler so it can be wired up
// as a separate Worker project (using the same D1 / KV / R2 bindings)
// in deployment. The cron is declared in wrangler.toml under [triggers]
// for documentation; the actual cron registration happens on the
// companion Worker.

import type { D1Database, KVNamespace, R2Bucket, ScheduledEvent } from '@cloudflare/workers-types'

export type DeletionEnv = {
  DB: D1Database
  META: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
  AVATARS: R2Bucket
  HUB: R2Bucket
}

// Runtime mirror of DeletionEnv's keys. The companion Worker's
// wrangler.toml must declare exactly these bindings; the deploy-shape
// test compares the two so a binding added here (or renamed there)
// fails CI instead of failing at 3am in the cron.
export const DELETION_BINDING_NAMES = [
  'DB',
  'META',
  'SNAPSHOTS',
  'OG',
  'AVATARS',
  'HUB',
] as const satisfies readonly (keyof DeletionEnv)[]

// Bounded window for the R2 orphan sweep — long enough to catch a
// waitUntil failure that the user wouldn't notice, short enough that the
// per-cron workload stays predictable. Anything older is assumed already
// in steady state.
const ORPHAN_SWEEP_WINDOW_MS = 7 * 24 * 3600 * 1000

// Cap on shares processed per orphan sweep. With a 6h cron this drains
// up to 2k stale objects/day — far above any realistic v0.5 backlog.
const ORPHAN_SWEEP_LIMIT = 500

// Bound one invocation's prefix work. Reaching the cap is an error so
// deletion_queue stays in place; the next cron resumes idempotently from
// the objects that remain under the prefix.
const R2_PREFIX_SWEEP_MAX_PAGES = 32

export async function runDeletionSweep(env: DeletionEnv, now: number): Promise<void> {
  await sweepDeletedUsers(env, now)
  await sweepOrphanShareAssets(env, now)
}

async function sweepDeletedUsers(env: DeletionEnv, now: number): Promise<void> {
  const due = await env.DB.prepare(
    'SELECT user_id FROM deletion_queue WHERE scheduled_at <= ? AND cancelled = 0',
  )
    .bind(now)
    .all<{ user_id: string }>()

  for (const row of due.results) {
    try {
      // Re-check inside the loop. The outer SELECT might have seen
      // this user before they POST'd DELETE /api/me/delete; D1 has no
      // row-level locking. This narrows the race window from "the
      // whole sweep duration" to "this user's processing time" — still
      // racy in principle, but ~100x smaller and acceptable for v0.5.
      const stillDue = await env.DB.prepare(
        'SELECT 1 FROM deletion_queue WHERE user_id=? AND cancelled=0 AND scheduled_at <= ?',
      )
        .bind(row.user_id, now)
        .first()
      if (!stillDue) continue

      // Fail closed before touching physical Hub data. Every Hub read
      // passes through requireReadableSession(), where withdrawn_at is
      // a hard 410 gate. If any later R2/D1 step fails, this tombstone
      // remains in place while the queue row drives a retry.
      await env.DB.prepare(
        'UPDATE hub_sessions SET withdrawn_at=?, updated_at=? WHERE owner_user_id=? AND withdrawn_at IS NULL',
      )
        .bind(now, now, row.user_id)
        .run()

      await deleteHubContent(env, row.user_id)

      const shares = await env.DB.prepare('SELECT id FROM published_shares WHERE user_id=?')
        .bind(row.user_id)
        .all<{ id: string }>()

      await Promise.all(
        shares.results.flatMap((s) => [
          env.META.put(
            `meta/${s.id}`,
            JSON.stringify({
              owner: row.user_id,
              revoked_at: now,
              visibility: 'unlisted',
              version: 0,
            }),
          ),
          env.SNAPSHOTS.delete(`${s.id}.json`),
          env.OG.delete(`${s.id}.png`),
        ]),
      )

      // Avatar R2 cleanup is retriable work too. Complete it before
      // the D1 scrub so an R2 failure cannot race the queue-row delete.
      await deleteAvatarPrefix(env, row.user_id)

      // D1 batches are transactional in D1: a failed statement rolls
      // the whole batch back. Keep deletion_queue out of this batch so
      // any D1 failure is retried; remove it only after every other
      // destructive step has completed.
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE published_shares SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
        ).bind(now, row.user_id),
        env.DB.prepare(
          'UPDATE handles SET released_at=? WHERE user_id=? AND released_at IS NULL',
        ).bind(now, row.user_id),
        // Drop every (provider, sub) link this user had. A fresh sign-in
        // from the same Google / GitHub / … account then finds no
        // identity row → upsertUserByIdentity creates a brand-new user
        // row, no permanent ban from the soft-deleted tombstone.
        env.DB.prepare('DELETE FROM user_identities WHERE user_id=?').bind(row.user_id),
        env.DB.prepare('DELETE FROM api_tokens WHERE user_id=?').bind(row.user_id),
        env.DB.prepare(
          "UPDATE users SET email='[deleted]', name=NULL, avatar_url=NULL, " +
            'display_name=NULL, custom_avatar_id=NULL, deleted_at=? WHERE id=?',
        ).bind(now, row.user_id),
      ])

      await env.DB.prepare('DELETE FROM deletion_queue WHERE user_id=?').bind(row.user_id).run()
    } catch (e) {
      // One bad user shouldn't block the rest of the sweep.
      console.error(
        JSON.stringify({
          message: 'account deletion sweep failed',
          userId: row.user_id,
          error: e instanceof Error ? e.message : String(e),
        }),
      )
    }
  }
}

async function deleteHubContent(env: DeletionEnv, userId: string): Promise<void> {
  // hub_objects is deduplicated per owner, and one physical pack can
  // contain objects used by several Sessions. Enumerate the owner's
  // DISTINCT physical pack keys instead of deriving a key per Session.
  const packs = await env.DB.prepare(
    'SELECT DISTINCT pack_key FROM hub_objects WHERE owner_user_id=?',
  )
    .bind(userId)
    .all<{ pack_key: string }>()

  await deleteR2Keys(
    env.HUB,
    packs.results.map((row) => row.pack_key),
  )

  // A pack upload reaches R2 before its hub_objects rows reach D1. If
  // that D1 insert fails, DISTINCT pack_key cannot discover the orphan.
  // The account's Hub write gate is already closed while deletion is
  // pending, so a complete owner-prefix sweep safely covers referenced
  // and orphaned packs alike. Any list/delete/page-limit failure throws
  // before the D1 rows or deletion_queue row are removed.
  await deleteR2Prefix(env.HUB, `hub/packs/${userId}/`)

  // Manifest keys are global (`hub/manifests/<root>`), not owner-scoped:
  // another owner committing the same content can share the key. There
  // is no cross-service transaction that makes a D1 reference check plus
  // R2 deletion race-free, so retain these small hash manifests rather
  // than risk breaking another owner's Session. The owner-scoped packs
  // above contain the actual Session bodies and are always deleted.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hub_objects WHERE owner_user_id=?').bind(userId),
    env.DB.prepare('DELETE FROM hub_sessions WHERE owner_user_id=?').bind(userId),
  ])
}

async function sweepOrphanShareAssets(env: DeletionEnv, now: number): Promise<void> {
  // The revoke endpoint relies on `waitUntil` to delete R2 objects. If
  // the worker invocation dies before that runs, the JSON + PNG linger
  // forever — reader still serves 410 (META gate is fail-closed) but
  // storage accrues. Sweep recent tombstones idempotently: R2.delete
  // is a no-op when the object is already gone, so this is cheap to
  // run unconditionally.
  const cutoff = now - ORPHAN_SWEEP_WINDOW_MS
  const stale = await env.DB.prepare(
    `SELECT id FROM published_shares
       WHERE revoked_at IS NOT NULL AND revoked_at > ?
       LIMIT ?`,
  )
    .bind(cutoff, ORPHAN_SWEEP_LIMIT)
    .all<{ id: string }>()

  await Promise.all(
    stale.results.flatMap((s) => [
      env.SNAPSHOTS.delete(`${s.id}.json`),
      env.OG.delete(`${s.id}.png`),
    ]),
  )
}

async function deleteAvatarPrefix(env: DeletionEnv, userId: string): Promise<void> {
  // Avatar keys live at `avatars/<user_id>/<id>.<ext>`. R2 list+delete
  // iterates by prefix; per-user upload history is bounded by the
  // upload rate-limit (10/h) so one page is the realistic case, but
  // we still page until R2 says it's done so a stuck/orphaned tail
  // doesn't survive the user's hard-delete.
  await deleteR2Prefix(env.AVATARS, `avatars/${userId}/`)
}

async function deleteR2Prefix(bucket: R2Bucket, prefix: string): Promise<void> {
  let cursor: string | undefined
  for (let page = 0; page < R2_PREFIX_SWEEP_MAX_PAGES; page++) {
    // Conditional spread instead of `cursor` directly: with
    // exactOptionalPropertyTypes, R2ListOptions doesn't accept an
    // explicit `cursor: undefined`.
    const listing = await bucket.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) })
    await deleteR2Keys(
      bucket,
      listing.objects.map((object) => object.key),
    )
    if (!listing.truncated) return
    cursor = listing.cursor
    if (!cursor) throw new Error(`R2 listing for ${prefix} was truncated without a cursor`)
  }
  throw new Error(`R2 prefix deletion exceeded its page limit: ${prefix}`)
}

async function deleteR2Keys(bucket: R2Bucket, keys: readonly string[]): Promise<void> {
  // Workers R2 accepts at most 1,000 keys per bulk delete. Missing keys
  // are harmless, which makes a partially completed retry idempotent.
  for (let start = 0; start < keys.length; start += 1000) {
    await bucket.delete(keys.slice(start, start + 1000))
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: DeletionEnv): Promise<void> {
    await runDeletionSweep(env, Date.now())
  },
}

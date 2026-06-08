// Scheduled deletion worker.
//
// Pages Functions do not support cron triggers directly; this file is
// shaped as a standard Workers `scheduled` handler so it can be wired up
// as a separate Worker project (using the same D1 / KV / R2 bindings)
// in deployment. The cron is declared in wrangler.toml under [triggers]
// for documentation; the actual cron registration happens on the
// companion Worker.

import type {
  D1Database,
  KVNamespace,
  R2Bucket,
  ScheduledEvent,
} from '@cloudflare/workers-types'

export type DeletionEnv = {
  DB: D1Database
  META: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
  AVATARS: R2Bucket
}

// Bounded window for the R2 orphan sweep — long enough to catch a
// waitUntil failure that the user wouldn't notice, short enough that the
// per-cron workload stays predictable. Anything older is assumed already
// in steady state.
const ORPHAN_SWEEP_WINDOW_MS = 7 * 24 * 3600 * 1000

// Cap on shares processed per orphan sweep. With a 6h cron this drains
// up to 2k stale objects/day — far above any realistic v0.5 backlog.
const ORPHAN_SWEEP_LIMIT = 500

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

      const shares = await env.DB.prepare(
        'SELECT id FROM published_shares WHERE user_id=?',
      )
        .bind(row.user_id)
        .all<{ id: string }>()

      await Promise.all(
        shares.results.flatMap((s) => [
          env.META.put(
            `meta/${s.id}`,
            JSON.stringify({
              owner: row.user_id,
              revoked_at: now,
              expires_at: null,
              visibility: 'unlisted',
              version: 0,
            }),
          ),
          env.SNAPSHOTS.delete(`${s.id}.json`),
          env.OG.delete(`${s.id}.png`),
        ]),
      )

      await Promise.all([
        env.DB.prepare(
          'UPDATE published_shares SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL',
        )
          .bind(now, row.user_id)
          .run(),
        env.DB.prepare(
          'UPDATE handles SET released_at=? WHERE user_id=? AND released_at IS NULL',
        )
          .bind(now, row.user_id)
          .run(),
        // Drop every (provider, sub) link this user had. A fresh sign-in
        // from the same Google / GitHub / … account then finds no
        // identity row → upsertUserByIdentity creates a brand-new user
        // row, no permanent ban from the soft-deleted tombstone.
        env.DB.prepare('DELETE FROM user_identities WHERE user_id=?')
          .bind(row.user_id)
          .run(),
        env.DB.prepare(
          "UPDATE users SET email='[deleted]', name=NULL, avatar_url=NULL, " +
            'display_name=NULL, custom_avatar_id=NULL, deleted_at=? WHERE id=?',
        )
          .bind(now, row.user_id)
          .run(),
        env.DB.prepare('DELETE FROM deletion_queue WHERE user_id=?')
          .bind(row.user_id)
          .run(),
        // R2 avatars/ prefix sweep. R2 list+delete must be paged for
        // very large prefixes; per-user the count is at most the upload
        // history (capped at 10/h via rate-limit), so one or two pages
        // is the realistic worst case.
        deleteAvatarPrefix(env, row.user_id),
      ])
    } catch (e) {
      // One bad user shouldn't block the rest of the sweep.
      console.error('deletion sweep failed for', row.user_id, e)
    }
  }
}

async function sweepOrphanShareAssets(env: DeletionEnv, now: number): Promise<void> {
  // The revoke endpoint and the share-expiration path rely on
  // `waitUntil` to delete R2 objects. If the worker invocation dies
  // before that runs, the JSON + PNG linger forever — reader still
  // serves 410 (META gate is fail-closed) but storage accrues. Sweep
  // recent tombstones idempotently: R2.delete is a no-op when the
  // object is already gone, so this is cheap to run unconditionally.
  const cutoff = now - ORPHAN_SWEEP_WINDOW_MS
  const stale = await env.DB.prepare(
    `SELECT id FROM published_shares
       WHERE (revoked_at IS NOT NULL AND revoked_at > ?)
          OR (expires_at IS NOT NULL AND expires_at <= ? AND revoked_at IS NULL)
       LIMIT ?`,
  )
    .bind(cutoff, now, ORPHAN_SWEEP_LIMIT)
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
  const prefix = `avatars/${userId}/`
  let cursor: string | undefined
  for (let page = 0; page < 32; page++) {
    const listing = await env.AVATARS.list({ prefix, limit: 1000, cursor })
    await Promise.all(
      listing.objects.map((o) => env.AVATARS.delete(o.key).catch(() => undefined)),
    )
    if (!listing.truncated) return
    cursor = listing.cursor
    if (!cursor) return
  }
}

export default {
  async scheduled(_event: ScheduledEvent, env: DeletionEnv): Promise<void> {
    await runDeletionSweep(env, Date.now())
  },
}

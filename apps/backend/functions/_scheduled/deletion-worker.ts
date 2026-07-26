// Scheduled deletion worker.
//
// Pages Functions do not support cron triggers directly; this file is
// shaped as a standard Workers `scheduled` handler so it can be wired up
// as a separate Worker project (using the same D1 / KV / R2 bindings)
// in deployment. The cron is declared in wrangler.toml under [triggers]
// for documentation; the actual cron registration happens on the
// companion Worker.

import type { D1Database, KVNamespace, R2Bucket, ScheduledEvent } from '@cloudflare/workers-types'

import { readObjects, teamPackKeyFor, writePack } from '../../src/hub/packs'
import type { ObjectLocation } from '../../src/hub/store'

type DeletionBindings = {
  DB: D1Database
  META: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
  AVATARS: R2Bucket
  HUB: R2Bucket
}

export type DeletionEnv = DeletionBindings & {
  // The WorkOS API key remains only on Pages. This Worker asks the protected
  // Pages endpoint to drain the shared D1 outbox after it enqueues cleanup.
  WORKOS_OPERATIONS_URL?: string
  WORKOS_OPERATIONS_TOKEN?: string
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
] as const satisfies readonly (keyof DeletionBindings)[]

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
const DELETION_PROCESSING_LEASE_MS = 30 * 60 * 1000

export async function runDeletionSweep(env: DeletionEnv, now: number): Promise<void> {
  await sweepDeletedUsers(env, now)
  await requestWorkosCleanupDrain(env)
  await pruneWorkosWebhookReceipts(env.DB, now).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        message: 'WorkOS webhook receipt pruning failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  })
  await sweepOrphanShareAssets(env, now)
}

async function sweepDeletedUsers(env: DeletionEnv, now: number): Promise<void> {
  const due = await env.DB.prepare(
    `SELECT user_id FROM deletion_queue
     WHERE scheduled_at<=? AND cancelled=0
       AND (state='pending' OR (state='processing' AND processing_lease_until<=?))`,
  )
    .bind(now, now)
    .all<{ user_id: string }>()

  for (const row of due.results) {
    const processingToken = `delete_${crypto.randomUUID().replace(/-/g, '')}`
    try {
      // This UPDATE is the linearization point with DELETE /api/me/delete.
      // A cancel transaction that wins first makes this claim change zero
      // rows; a claim that wins first moves to processing and cancellation
      // must report 409 rather than falsely promising recovery.
      const claimed = await env.DB.prepare(
        `/* account-deletion:claim */
           UPDATE deletion_queue
           SET state='processing', processing_token=?, processing_lease_until=?
           WHERE user_id=? AND scheduled_at<=? AND cancelled=0
             AND (state='pending' OR (state='processing' AND processing_lease_until<=?))
             AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id=deletion_queue.user_id AND u.deleted_at IS NULL
                 AND u.deletion_pending_until IS NOT NULL
             )
             AND NOT EXISTS (
               SELECT 1 FROM team_memberships membership
               JOIN teams team ON team.id=membership.team_id
               WHERE membership.user_id=deletion_queue.user_id
                 AND membership.role='owner' AND team.archived_at IS NULL
             )`,
      )
        .bind(processingToken, now + DELETION_PROCESSING_LEASE_MS, row.user_id, now, now)
        .run()
      if ((claimed.meta.changes ?? 0) === 0) {
        // The destructive D1 batch may have committed before the final queue
        // delete failed. Retire that terminal row without trying to claim or
        // repeat account cleanup against an already-tombstoned user.
        await env.DB.prepare(
          `DELETE FROM deletion_queue
             WHERE user_id=? AND EXISTS (
               SELECT 1 FROM users u
               WHERE u.id=deletion_queue.user_id AND u.deleted_at IS NOT NULL
             )`,
        )
          .bind(row.user_id)
          .run()
        await cancelDeletionIfActiveOwner(env.DB, row.user_id)
        continue
      }

      const requireClaim = () => renewDeletionClaim(env.DB, row.user_id, processingToken)
      await requireClaim()

      // Fail closed before touching physical Hub data. Every Hub read
      // passes through requireReadableSession(), where withdrawn_at is
      // a hard 410 gate. If any later R2/D1 step fails, this tombstone
      // remains in place while the queue row drives a retry.
      await env.DB.prepare(
        'UPDATE hub_sessions SET withdrawn_at=?, updated_at=? WHERE owner_user_id=? AND team_id IS NULL AND withdrawn_at IS NULL',
      )
        .bind(now, now, row.user_id)
        .run()

      await requireClaim()
      await deleteHubContent(env, row.user_id, requireClaim)

      const shares = await env.DB.prepare('SELECT id FROM published_shares WHERE user_id=?')
        .bind(row.user_id)
        .all<{ id: string }>()

      await requireClaim()
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
      await requireClaim()
      await deleteAvatarPrefix(env, row.user_id)

      // D1 batches are transactional in D1: a failed statement rolls
      // the whole batch back. Keep deletion_queue out of this batch so
      // any D1 failure is retried; remove it only after every other
      // destructive step has completed.
      const workosIdentity = await env.DB.prepare(
        "SELECT provider_sub FROM user_identities WHERE user_id=? AND provider='workos'",
      )
        .bind(row.user_id)
        .first<{ provider_sub: string }>()

      const cleanupStatements = [
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
        // Users are soft-deleted, so the user_id FK cannot remove stars they
        // placed on other authors' Sessions. Keep this in the final D1 scrub
        // transaction so no tombstoned viewer continues contributing stars.
        env.DB.prepare(
          '/* account-deletion:delete-viewer-stars */ DELETE FROM hub_session_stars WHERE user_id=?',
        ).bind(row.user_id),
        env.DB.prepare(
          `/* deletion:enqueue-workos-memberships */
             INSERT INTO workos_cleanup_outbox
               (id, operation, resource_id, team_id, user_id, attempts,
                next_attempt_at, last_error, created_at, updated_at)
             SELECT 'woc_' || lower(hex(randomblob(16))), 'membership.delete',
                    workos_membership_id, team_id, user_id, 0, ?, NULL, ?, ?
             FROM team_memberships
             WHERE user_id=? AND workos_membership_id IS NOT NULL
             ON CONFLICT(operation,resource_id) DO UPDATE SET
               next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
               updated_at=excluded.updated_at`,
        ).bind(now, now, now, row.user_id),
        env.DB.prepare('DELETE FROM team_memberships WHERE user_id=?').bind(row.user_id),
        env.DB.prepare(
          "UPDATE users SET email='[deleted]', name=NULL, avatar_url=NULL, " +
            'display_name=NULL, custom_avatar_id=NULL, deleted_at=? WHERE id=?',
        ).bind(now, row.user_id),
      ]
      if (workosIdentity) {
        cleanupStatements.unshift(
          env.DB.prepare(
            'INSERT INTO team_membership_blocks (team_id, user_id, workos_user_id, blocked_at, blocked_by_user_id) ' +
              'SELECT team_id, user_id, ?, ?, user_id FROM team_memberships WHERE user_id=? ' +
              'ON CONFLICT(team_id,user_id) DO UPDATE SET workos_user_id=excluded.workos_user_id, blocked_at=excluded.blocked_at, blocked_by_user_id=excluded.blocked_by_user_id',
          ).bind(workosIdentity.provider_sub, now, row.user_id),
        )
      }
      await requireClaim()
      await env.DB.batch(cleanupStatements)

      await env.DB.prepare(
        "DELETE FROM deletion_queue WHERE user_id=? AND state='processing' AND processing_token=?",
      )
        .bind(row.user_id, processingToken)
        .run()
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

async function cancelDeletionIfActiveOwner(db: D1Database, userId: string): Promise<void> {
  const activeOwnership = await db
    .prepare(
      "SELECT COUNT(*) AS count FROM team_memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? AND m.role='owner' AND t.archived_at IS NULL",
    )
    .bind(userId)
    .first<{ count: number }>()
  if (Number(activeOwnership?.count ?? 0) === 0) return
  await db.batch([
    db
      .prepare(
        `UPDATE deletion_queue
         SET cancelled=1, state='cancelled', processing_token=NULL,
             processing_lease_until=NULL
         WHERE user_id=? AND state='pending' AND cancelled=0`,
      )
      .bind(userId),
    db
      .prepare(
        `UPDATE users SET deletion_pending_until=NULL
         WHERE id=? AND EXISTS (
           SELECT 1 FROM deletion_queue q
           WHERE q.user_id=users.id AND q.state='cancelled'
         )`,
      )
      .bind(userId),
  ])
  console.warn(
    JSON.stringify({
      message: 'account deletion cancelled because user owns an active team',
      userId,
    }),
  )
}

async function renewDeletionClaim(
  db: D1Database,
  userId: string,
  processingToken: string,
): Promise<void> {
  const renewed = await db
    .prepare(
      `/* account-deletion:renew-claim */
       UPDATE deletion_queue SET processing_lease_until=?
       WHERE user_id=? AND state='processing' AND cancelled=0 AND processing_token=?
         AND EXISTS (
           SELECT 1 FROM users u
           WHERE u.id=deletion_queue.user_id AND u.deleted_at IS NULL
             AND u.deletion_pending_until IS NOT NULL
         )
         AND NOT EXISTS (
           SELECT 1 FROM team_memberships membership
           JOIN teams team ON team.id=membership.team_id
           WHERE membership.user_id=deletion_queue.user_id
             AND membership.role='owner' AND team.archived_at IS NULL
         )`,
    )
    .bind(Date.now() + DELETION_PROCESSING_LEASE_MS, userId, processingToken)
    .run()
  if ((renewed.meta.changes ?? 0) === 0) {
    throw new Error('account deletion processing claim lost')
  }
}

async function requestWorkosCleanupDrain(env: DeletionEnv): Promise<void> {
  if (!env.WORKOS_OPERATIONS_URL || !env.WORKOS_OPERATIONS_TOKEN) return
  let url: URL
  try {
    url = new URL(env.WORKOS_OPERATIONS_URL)
  } catch {
    console.error(JSON.stringify({ message: 'invalid WorkOS operations URL' }))
    return
  }
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    console.error(JSON.stringify({ message: 'insecure WorkOS operations URL' }))
    return
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.WORKOS_OPERATIONS_TOKEN}` },
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(
        JSON.stringify({
          message: 'WorkOS cleanup drain request failed',
          status: response.status,
        }),
      )
    }
    await response.body?.cancel()
  } catch (error) {
    console.error(
      JSON.stringify({
        message: 'WorkOS cleanup drain request failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  } finally {
    clearTimeout(timeout)
  }
}

async function pruneWorkosWebhookReceipts(db: D1Database, now: number): Promise<void> {
  const retentionCutoff = now - 30 * 24 * 60 * 60 * 1000
  await db
    .prepare('DELETE FROM workos_webhook_events WHERE processed_at IS NOT NULL AND received_at<?')
    .bind(retentionCutoff)
    .run()
}

async function deleteHubContent(
  env: DeletionEnv,
  userId: string,
  requireClaim: () => Promise<void>,
): Promise<void> {
  // hub_objects is deduplicated per owner, and one physical pack can
  // contain objects used by several Sessions. Enumerate the owner's
  // DISTINCT physical pack keys instead of deriving a key per Session.
  const packs = await env.DB.prepare(
    'SELECT DISTINCT pack_key FROM hub_objects WHERE owner_user_id=?',
  )
    .bind(userId)
    .all<{ pack_key: string }>()

  // A Team transfer initially aliases immutable objects rather than copying a
  // potentially gigabyte-sized Session in one HTTP request. Before erasing an
  // account, re-home every such alias into a Team-owned pack so Team resources
  // survive while unrelated personal bytes remain fully erasable.
  await requireClaim()
  await rehomeTeamObjectsFromPersonalPrefix(env, userId)

  await requireClaim()
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
  await requireClaim()
  await deleteR2Prefix(env.HUB, `hub/packs/${userId}/`)

  // Manifest keys are global (`hub/manifests/<root>`), not owner-scoped:
  // another owner committing the same content can share the key. There
  // is no cross-service transaction that makes a D1 reference check plus
  // R2 deletion race-free, so retain these small hash manifests rather
  // than risk breaking another owner's Session. The owner-scoped packs
  // above contain the actual Session bodies and are always deleted.
  await requireClaim()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hub_objects WHERE owner_user_id=?').bind(userId),
    env.DB.prepare(
      `/* account-deletion:delete-target-stars */
       DELETE FROM hub_session_stars
       WHERE sid IN (
         SELECT sid FROM hub_sessions
         WHERE owner_user_id=? AND team_id IS NULL
       )`,
    ).bind(userId),
    env.DB.prepare('DELETE FROM hub_sessions WHERE owner_user_id=? AND team_id IS NULL').bind(
      userId,
    ),
    env.DB.prepare(
      `/* account-deletion:delete-personal-project-receipts */
       DELETE FROM project_creation_requests
       WHERE owner_user_id=? AND owner_team_id IS NULL`,
    ).bind(userId),
    env.DB.prepare(
      `/* account-deletion:delete-personal-projects */
       DELETE FROM projects
       WHERE owner_user_id=? AND owner_team_id IS NULL`,
    ).bind(userId),
  ])
}

type TeamObjectLocation = ObjectLocation & { team_id: string }

async function rehomeTeamObjectsFromPersonalPrefix(
  env: DeletionEnv,
  userId: string,
): Promise<void> {
  const prefix = `hub/packs/${userId}/`
  const referencedPacks = await env.DB.prepare(
    'SELECT DISTINCT pack_key FROM hub_team_objects WHERE pack_key LIKE ?',
  )
    .bind(`${prefix}%`)
    .all<{ pack_key: string }>()

  for (const { pack_key: oldPackKey } of referencedPacks.results) {
    const references = await env.DB.prepare(
      'SELECT team_id, oid, pack_key, offset, length FROM hub_team_objects WHERE pack_key=? ORDER BY team_id, oid',
    )
      .bind(oldPackKey)
      .all<TeamObjectLocation>()
    const byTeam = new Map<string, TeamObjectLocation[]>()
    for (const reference of references.results) {
      const group = byTeam.get(reference.team_id)
      if (group) group.push(reference)
      else byTeam.set(reference.team_id, [reference])
    }

    for (const [teamId, locations] of byTeam) {
      const bodies = await readObjects(env.HUB, locations)
      const entries = locations.map((location) => {
        const data = bodies.get(location.oid)
        if (data === undefined) throw new Error(`Team object unreadable: ${location.oid}`)
        return { oid: location.oid, data }
      })
      const newPackKey = teamPackKeyFor(teamId, crypto.randomUUID())
      const placements = await writePack(env.HUB, newPackKey, entries)
      const updates = placements.map((placement) =>
        env.DB.prepare(
          'UPDATE hub_team_objects SET pack_key=?, offset=?, length=? WHERE team_id=? AND oid=? AND pack_key=?',
        ).bind(newPackKey, placement.offset, placement.length, teamId, placement.oid, oldPackKey),
      )
      for (let start = 0; start < updates.length; start += 80) {
        await env.DB.batch(updates.slice(start, start + 80))
      }
    }
  }

  const remaining = await env.DB.prepare(
    'SELECT 1 FROM hub_team_objects WHERE pack_key LIKE ? LIMIT 1',
  )
    .bind(`${prefix}%`)
    .first()
  if (remaining) throw new Error(`Team objects still reference personal Hub packs for ${userId}`)
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

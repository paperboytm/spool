import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../src/audit-after-commit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

type DeletionQueueState = {
  scheduled_at: number
  state: 'pending' | 'processing' | 'cancelled'
}

type AccountDeletionState = {
  deleted_at: number | null
  deletion_pending_until: number | null
  scheduled_at: number | null
  state: 'pending' | 'processing' | 'cancelled' | null
}

// User-visible grace window between scheduling deletion and the worker
// actually executing it. Long enough for "I changed my mind" via the
// DELETE cancel path; short enough that abandoned accounts don't linger.
const GRACE_PERIOD_MS = 24 * 3600 * 1000

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    // A lost response after the schedule transaction must be replayable while
    // the account is pending. The ordinary auth gate would otherwise turn a
    // committed operation into a misleading 403 on retry.
    const user = await requireUser(ctx.request, ctx.env, { allowPendingDeletion: true })
    const existing = await getDeletionQueueState(ctx.env.DB, user.id)
    if (user.deletion_pending_until !== null && existing?.state !== 'cancelled') {
      return jsonOk({ scheduled_at: existing?.scheduled_at ?? user.deletion_pending_until })
    }

    const owned = await ctx.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM team_memberships m JOIN teams t ON t.id=m.team_id WHERE m.user_id=? AND m.role='owner' AND t.archived_at IS NULL",
    )
      .bind(user.id)
      .first<{ count: number }>()
    if ((owned?.count ?? 0) > 0) {
      throw new ApiError(
        'CONFLICT',
        'transfer or archive every Team you own before deleting your account',
      )
    }

    const until = Date.now() + GRACE_PERIOD_MS
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `/* account-deletion:schedule-user */
           UPDATE users SET deletion_pending_until=?
           WHERE id=? AND deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM team_memberships m JOIN teams t ON t.id=m.team_id
               WHERE m.user_id=users.id AND m.role='owner' AND t.archived_at IS NULL
             )
             AND (
               deletion_pending_until IS NULL OR NOT EXISTS (
                 SELECT 1 FROM deletion_queue q
                 WHERE q.user_id=users.id AND q.state IN ('pending','processing')
               )
             )`,
      ).bind(until, user.id),
      ctx.env.DB.prepare(
        `/* account-deletion:schedule-queue */
           INSERT INTO deletion_queue
             (user_id, scheduled_at, cancelled, state, processing_token, processing_lease_until)
           SELECT id, ?, 0, 'pending', NULL, NULL FROM users
           WHERE id=? AND deleted_at IS NULL AND deletion_pending_until=?
           ON CONFLICT(user_id) DO UPDATE SET
             scheduled_at=excluded.scheduled_at,
             cancelled=0,
             state='pending',
             processing_token=NULL,
             processing_lease_until=NULL
           WHERE deletion_queue.state='cancelled'`,
      ).bind(until, user.id, until),
    ])
    const scheduled = await getDeletionQueueState(ctx.env.DB, user.id)
    if (!scheduled || scheduled.state === 'cancelled') {
      const current = await getAccountDeletionState(ctx.env.DB, user.id)
      if (!current || current.deleted_at !== null) throw new ApiError('GONE', 'account deleted')
      throw new ApiError(
        'CONFLICT',
        'transfer or archive every Team you own before deleting your account',
      )
    }

    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'account.delete.scheduled',
    })
    return jsonOk({ scheduled_at: scheduled.scheduled_at })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env, { allowPendingDeletion: true })
    // D1 batches are transactional. Whichever transaction wins first defines
    // the boundary: cancel changes pending -> cancelled and clears the user;
    // the cron claim changes pending -> processing and cancel must return 409.
    await ctx.env.DB.batch([
      ctx.env.DB.prepare(
        `/* account-deletion:cancel-queue */
           UPDATE deletion_queue
           SET cancelled=1, state='cancelled', processing_token=NULL,
               processing_lease_until=NULL
           WHERE user_id=? AND state='pending' AND cancelled=0`,
      ).bind(user.id),
      ctx.env.DB.prepare(
        `/* account-deletion:cancel-user */
           UPDATE users SET deletion_pending_until=NULL
           WHERE id=? AND deleted_at IS NULL AND (
             NOT EXISTS (SELECT 1 FROM deletion_queue q WHERE q.user_id=users.id)
             OR EXISTS (
               SELECT 1 FROM deletion_queue q
               WHERE q.user_id=users.id AND q.state='cancelled'
             )
           )`,
      ).bind(user.id),
    ])
    const current = await getAccountDeletionState(ctx.env.DB, user.id)
    if (!current || current.deleted_at !== null) throw new ApiError('GONE', 'account deleted')
    if (current.state === 'processing') {
      throw new ApiError('CONFLICT', 'account deletion is already in progress')
    }
    if (current.state === 'pending' || current.deletion_pending_until !== null) {
      throw new ApiError('CONFLICT', 'account deletion state changed; retry cancellation')
    }

    auditAfterCommit(ctx, { user_id: user.id, action: 'account.delete.cancel' })
    return jsonOk({ cancelled: true })
  } catch (error) {
    return jsonError(error)
  }
}

async function getAccountDeletionState(
  db: D1Database,
  userId: string,
): Promise<AccountDeletionState | null> {
  return db
    .prepare(
      `SELECT u.deleted_at, u.deletion_pending_until,
              q.scheduled_at, q.state
       FROM users u LEFT JOIN deletion_queue q ON q.user_id=u.id
       WHERE u.id=?`,
    )
    .bind(userId)
    .first<AccountDeletionState>()
}

async function getDeletionQueueState(
  db: D1Database,
  userId: string,
): Promise<DeletionQueueState | null> {
  return db
    .prepare('SELECT scheduled_at, state FROM deletion_queue WHERE user_id=?')
    .bind(userId)
    .first<DeletionQueueState>()
}

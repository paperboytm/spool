import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

// User-visible grace window between scheduling deletion and the worker
// actually executing it. Long enough for "I changed my mind" via the
// DELETE cancel path; short enough that abandoned accounts don't linger.
const GRACE_PERIOD_MS = 24 * 3600 * 1000

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const until = Date.now() + GRACE_PERIOD_MS
    await ctx.env.DB
      .prepare('UPDATE users SET deletion_pending_until=? WHERE id=? AND deleted_at IS NULL')
      .bind(until, user.id)
      .run()
    await ctx.env.DB
      .prepare(
        'INSERT OR REPLACE INTO deletion_queue (user_id, scheduled_at, cancelled) VALUES (?, ?, 0)',
      )
      .bind(user.id, until)
      .run()
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'account.delete.scheduled',
    })
    return jsonOk({ scheduled_at: until })
  } catch (e) {
    return jsonError(e)
  }
}

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env, { allowPendingDeletion: true })
    await ctx.env.DB
      .prepare('UPDATE users SET deletion_pending_until=NULL WHERE id=?')
      .bind(user.id)
      .run()
    await ctx.env.DB
      .prepare('UPDATE deletion_queue SET cancelled=1 WHERE user_id=?')
      .bind(user.id)
      .run()
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'account.delete.cancel',
    })
    return jsonOk({ cancelled: true })
  } catch (e) {
    return jsonError(e)
  }
}

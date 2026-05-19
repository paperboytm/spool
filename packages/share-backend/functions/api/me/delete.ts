import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { jsonError } from '../../../src/errors'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const until = Date.now() + 24 * 3600 * 1000
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
    return new Response(
      JSON.stringify({ scheduled_at: until }),
      { headers: { 'content-type': 'application/json' } },
    )
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
    return new Response('{"cancelled":true}', {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    return jsonError(e)
  }
}

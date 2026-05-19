import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'
import { checkRate } from '../../../src/rate-limit'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'claim',
      key: user.id,
      windowSec: 86400,
      max: 5,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const body = (await ctx.request.json().catch(() => ({}))) as { handle?: unknown }
    const v = validateHandle(body?.handle ?? '')
    if (!v.ok) throw new ApiError('UNPROCESSABLE', v.reason)

    const [existing, prior] = await Promise.all([
      ctx.env.DB
        .prepare('SELECT user_id FROM handles WHERE handle=? AND released_at IS NULL')
        .bind(v.handle)
        .first<{ user_id: string }>(),
      ctx.env.DB
        .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL')
        .bind(user.id)
        .first<{ handle: string }>(),
    ])
    if (existing && existing.user_id !== user.id) {
      throw new ApiError('CONFLICT', 'handle taken')
    }
    if (prior && prior.handle !== v.handle) {
      throw new ApiError('CONFLICT', 'user already has a handle')
    }

    if (!existing) {
      await ctx.env.DB
        .prepare('INSERT INTO handles (handle, user_id, claimed_at) VALUES (?, ?, ?)')
        .bind(v.handle, user.id, Date.now())
        .run()
    }

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'handle.claim',
      target_id: v.handle,
    })
    return jsonOk({ handle: v.handle })
  } catch (e) {
    return jsonError(e)
  }
}

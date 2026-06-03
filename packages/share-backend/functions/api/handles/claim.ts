import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'
import { checkRate } from '../../../src/rate-limit'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

// 5 attempts per user per day is enough for a real human exploring
// available names, far short of bulk squatting.
const CLAIM_RATE_WINDOW_SEC = 86400
const CLAIM_RATE_MAX = 5

// SQLite/D1 surface UNIQUE-PK collisions with this string. Stable across
// D1 versions; the exact prefix is `UNIQUE constraint failed: <table>.<col>`.
function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message)
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'claim',
      key: user.id,
      windowSec: CLAIM_RATE_WINDOW_SEC,
      max: CLAIM_RATE_MAX,
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
      // TOCTOU: a concurrent claim could have raced past the SELECT
      // above and INSERTed first. Map the PK violation to 409 instead
      // of letting jsonError surface it as 500 INTERNAL.
      try {
        await ctx.env.DB
          .prepare('INSERT INTO handles (handle, user_id, claimed_at) VALUES (?, ?, ?)')
          .bind(v.handle, user.id, Date.now())
          .run()
      } catch (e) {
        if (isUniqueViolation(e)) throw new ApiError('CONFLICT', 'handle taken')
        throw e
      }
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

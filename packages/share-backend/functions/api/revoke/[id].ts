import type {
  D1Database,
  KVNamespace,
  PagesFunction,
  R2Bucket,
} from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { isValidSlug } from '../../../src/publish/slug'
import { checkRate } from '../../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  META: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
  RATE: KVNamespace
}

// Owner-scoped (you can only revoke your own), so the bucket is mostly
// cost discipline — caps a leaked-token attacker's ability to spin up
// META/D1/R2 writes in a tight loop. Same hourly shape as publish.
const REVOKE_RATE_WINDOW_SEC = 3600
const REVOKE_RATE_MAX = 60

export const onRequestPost: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    const id = ctx.params.id as string
    if (!isValidSlug(id)) throw new ApiError('NOT_FOUND')
    const user = await requireUser(ctx.request, ctx.env)

    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'revoke',
      key: user.id,
      windowSec: REVOKE_RATE_WINDOW_SEC,
      max: REVOKE_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const owned = await ctx.env.DB.prepare(
      'SELECT 1 FROM published_shares WHERE id=? AND user_id=?',
    )
      .bind(id, user.id)
      .first()
    if (!owned) throw new ApiError('NOT_FOUND')

    const now = Date.now()
    // Write order matches the publish handler's discipline: D1 row
    // is the source of truth for owner / state, KV is the tombstone
    // cache the reader hits first. If we wrote KV first and the D1
    // write then failed, the owner's `/api/me/shares` would still
    // show the row as live (`revoked_at IS NULL`), the share would
    // 410 to readers via the KV tombstone, and a subsequent
    // republish attempt would find the live row and overwrite it
    // — burying the tombstone without clearing it. D1 first means a
    // partial failure leaves the row revoked from the owner's view
    // and a retry can complete the tombstone work.
    await ctx.env.DB.prepare(
      'UPDATE published_shares SET revoked_at=? WHERE id=?',
    )
      .bind(now, id)
      .run()

    const metaRaw = await ctx.env.META.get(`meta/${id}`)
    if (metaRaw) {
      const m = JSON.parse(metaRaw)
      m.revoked_at = now
      await ctx.env.META.put(`meta/${id}`, JSON.stringify(m))
    }

    // KV tombstone already enforces 410 on reads; R2 cleanup is fire-and-forget.
    ctx.waitUntil(
      Promise.all([
        ctx.env.SNAPSHOTS.delete(`${id}.json`),
        ctx.env.OG.delete(`${id}.png`),
      ]).then(() => undefined),
    )

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'revoke',
      target_id: id,
    })
    return jsonOk({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

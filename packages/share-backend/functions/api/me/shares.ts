import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'
import { CC_PRIVATE_NO_CACHE } from '../../../src/security/cache-control'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rows = await ctx.env.DB
      .prepare(
        'SELECT id, title, visibility, expires_at, version, published_at, republished_at, revoked_at, draft_id, client_request_id ' +
          'FROM published_shares WHERE user_id=? ORDER BY published_at DESC',
      )
      .bind(user.id)
      .all()
    return jsonOk(
      { items: rows.results },
      { headers: { 'cache-control': CC_PRIVATE_NO_CACHE } },
    )
  } catch (e) {
    return jsonError(e)
  }
}

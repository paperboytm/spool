import type { D1Database, PagesFunction } from '@cloudflare/workers-types'

import { jsonError, jsonOk } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'

type Env = { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const handle = new URL(ctx.request.url).searchParams.get('h') ?? ''
    const v = validateHandle(handle)
    if (!v.ok) return jsonOk({ available: false, reason: v.reason })
    // NOTE: `handles.handle` is the table PK, so once a row exists the
    // value is occupied for INSERT purposes even after `released_at` is
    // set. This query matches the design intent (released handles are
    // re-claimable) — when the release flow ships, the claim path must
    // switch to INSERT … ON CONFLICT(handle) DO UPDATE SET released_at=NULL.
    const row = await ctx.env.DB
      .prepare('SELECT 1 FROM handles WHERE handle=? AND released_at IS NULL')
      .bind(v.handle)
      .first()
    return jsonOk({ available: !row })
  } catch (e) {
    return jsonError(e)
  }
}

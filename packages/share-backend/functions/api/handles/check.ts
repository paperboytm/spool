import type { D1Database, PagesFunction } from '@cloudflare/workers-types'

import { jsonError, jsonOk } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'

type Env = { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const handle = new URL(ctx.request.url).searchParams.get('h') ?? ''
    const v = validateHandle(handle)
    if (!v.ok) return jsonOk({ available: false, reason: v.reason })
    const row = await ctx.env.DB
      .prepare('SELECT 1 FROM handles WHERE handle=? AND released_at IS NULL')
      .bind(v.handle)
      .first()
    return jsonOk({ available: !row })
  } catch (e) {
    return jsonError(e)
  }
}

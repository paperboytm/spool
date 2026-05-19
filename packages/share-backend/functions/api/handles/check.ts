import type { D1Database, PagesFunction } from '@cloudflare/workers-types'

import { jsonError } from '../../../src/errors'
import { validateHandle } from '../../../src/handles'

type Env = { DB: D1Database }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const handle = new URL(ctx.request.url).searchParams.get('h') ?? ''
    const v = validateHandle(handle)
    if (!v.ok) {
      return new Response(
        JSON.stringify({ available: false, reason: v.reason }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
    const row = await ctx.env.DB
      .prepare('SELECT 1 FROM handles WHERE handle=? AND released_at IS NULL')
      .bind(v.handle)
      .first()
    return new Response(
      JSON.stringify({ available: !row }),
      { headers: { 'content-type': 'application/json' } },
    )
  } catch (e) {
    return jsonError(e)
  }
}

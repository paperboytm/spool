import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const handle = await ctx.env.DB
      .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL')
      .bind(user.id)
      .first<{ handle: string }>()
    return jsonOk({
      id: user.id,
      email: user.email,
      name: user.name,
      avatar_url: user.avatar_url,
      handle: handle?.handle ?? null,
    })
  } catch (e) {
    return jsonError(e)
  }
}

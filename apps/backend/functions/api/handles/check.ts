import type { D1Database, PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { profilesEnabled, validateHandle } from '../../../src/handles'
import { ccPublicRevalidate } from '../../../src/security/cache-control'

type Env = { DB: D1Database; PROFILES_ENABLED?: string }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    // Profiles are gated off at launch — see profilesEnabled().
    if (!profilesEnabled(ctx.env)) throw new ApiError('NOT_FOUND')
    const handle = new URL(ctx.request.url).searchParams.get('h') ?? ''
    const v = validateHandle(handle)
    const headers = { 'cache-control': ccPublicRevalidate(10) }
    if (!v.ok) return jsonOk({ available: false, reason: v.reason }, { headers })
    // Handles are permanent URL tombstones. Account/Team deletion makes the
    // route inactive but never lets a different owner inherit old links.
    const row = await ctx.env.DB.prepare('SELECT 1 FROM handles WHERE handle=?')
      .bind(v.handle)
      .first()
    return jsonOk({ available: !row }, { headers })
  } catch (e) {
    return jsonError(e)
  }
}

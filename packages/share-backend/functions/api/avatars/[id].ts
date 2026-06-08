// GET /api/avatars/:user_id — serve the user's custom avatar from R2.
//
// Why a backend endpoint instead of a raw R2 public URL: keeps the
// avatar URL stable across re-uploads (the R2 key includes a random
// id and content extension that changes on each upload), hides the
// bucket layout from the public, and gives us one place to add cache
// headers / future signed-URL gating.
//
// 404 when the user has no custom avatar set. Caller falls back to the
// provider avatar (users.avatar_url) — the OG render at publish time
// already encodes whichever was active then, so a later avatar change
// only affects subsequent renders. That's the intended behaviour.

import type { D1Database, PagesFunction, R2Bucket } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../src/errors'

type Env = { DB: D1Database; AVATARS: R2Bucket }

// 5 minutes at the edge. Custom avatars rarely change, but when a
// user uploads a new one they expect to see it on next paint — long
// caches would make that a "log out + log in" reset for the global
// audience. 5 min balances CDN cost vs propagation.
const AVATAR_CACHE_HEADER = 'public, max-age=300, s-maxage=300, must-revalidate'

const USER_ID_RE = /^[A-Za-z0-9_-]{8,32}$/

export const onRequestGet: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    const userId = ctx.params.id as string
    if (!USER_ID_RE.test(userId)) throw new ApiError('NOT_FOUND')

    // Check `avatar_visible` too — /api/me + /api/profiles already gate
    // the URL on this flag, so anyone holding a stale `/api/avatars/<id>`
    // link must also get 404 once the user opts to hide their photo.
    // Without this the GET endpoint is the bypass that defeats the
    // resolver-level gate.
    const row = await ctx.env.DB
      .prepare('SELECT custom_avatar_id, avatar_visible FROM users WHERE id=? AND deleted_at IS NULL')
      .bind(userId)
      .first<{ custom_avatar_id: string | null; avatar_visible: number | null }>()
    if (!row?.custom_avatar_id) throw new ApiError('NOT_FOUND')
    if ((row.avatar_visible ?? 1) === 0) throw new ApiError('NOT_FOUND')

    const key = `avatars/${userId}/${row.custom_avatar_id}`
    const obj = await ctx.env.AVATARS.get(key)
    if (!obj) throw new ApiError('NOT_FOUND')

    const ct = obj.httpMetadata?.contentType ?? guessContentTypeFromKey(row.custom_avatar_id)
    return new Response(obj.body as unknown as BodyInit, {
      headers: {
        'content-type': ct,
        'cache-control': AVATAR_CACHE_HEADER,
        // ETag on the avatar id (which changes every upload) so a re-
        // upload invalidates downstream caches cleanly.
        etag: `"${row.custom_avatar_id}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

function guessContentTypeFromKey(id: string): string {
  if (id.endsWith('.png')) return 'image/png'
  if (id.endsWith('.jpg')) return 'image/jpeg'
  if (id.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

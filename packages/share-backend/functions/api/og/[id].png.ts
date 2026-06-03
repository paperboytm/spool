import type { KVNamespace, PagesFunction, R2Bucket } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../src/errors'
import { isValidSlug } from '../../../src/publish/slug'

type Env = { META: KVNamespace; OG: R2Bucket }

// Mirrors snapshots/[id].ts — same 30s window + must-revalidate so the
// OG preview a social platform shows stops at the same time the JSON
// reader does after a revoke. Without alignment, the PNG could linger
// at the edge for 5× longer than the underlying snapshot.
const OG_CACHE_MAX_AGE_SEC = 30
const OG_CACHE_HEADER =
  `public, max-age=${OG_CACHE_MAX_AGE_SEC}, s-maxage=${OG_CACHE_MAX_AGE_SEC}, must-revalidate`

type Meta = {
  owner: string
  visibility: 'unlisted' | 'profile-listed'
  expires_at: number | null
  revoked_at: number | null
  version: number
}

export const onRequestGet: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    // CF Pages strips the `.png` suffix from `[id].png.ts` routes at runtime,
    // but our unit tests construct ctx.params directly with the raw slug,
    // so strip defensively to keep both paths working.
    const raw = ctx.params.id as string
    const id = raw.replace(/\.png$/, '')
    if (!isValidSlug(id)) throw new ApiError('NOT_FOUND')

    const metaRaw = await ctx.env.META.get(`meta/${id}`)
    if (!metaRaw) throw new ApiError('NOT_FOUND')
    const meta = JSON.parse(metaRaw) as Meta

    if (meta.revoked_at) throw new ApiError('GONE')
    if (meta.expires_at && Date.now() > meta.expires_at) throw new ApiError('GONE')

    const obj = await ctx.env.OG.get(`${id}.png`)
    if (!obj) throw new ApiError('NOT_FOUND')

    return new Response(obj.body as unknown as BodyInit, {
      headers: {
        'content-type': 'image/png',
        'cache-control': OG_CACHE_HEADER,
        etag: `"${id}-${meta.version}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

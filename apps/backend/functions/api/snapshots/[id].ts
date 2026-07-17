import type { KVNamespace, PagesFunction, R2Bucket } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../src/errors'
import { isValidSlug } from '../../../src/publish/slug'
import { CC_NO_STORE } from '../../../src/security/cache-control'

type Env = { META: KVNamespace; SNAPSHOTS: R2Bucket; RATE: KVNamespace }

const TOMBSTONE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': CC_NO_STORE,
}

// 30s window keeps CDN cost manageable for viral shares while bounding the
// post-revoke vulnerability — a panic revoke is fully effective inside
// half a minute everywhere except in already-loaded browser tabs. The
// must-revalidate disposition forces shared caches to re-check on next
// hit instead of refreshing lazily.
const SNAPSHOT_CACHE_MAX_AGE_SEC = 30
const SNAPSHOT_CACHE_HEADER =
  `public, max-age=${SNAPSHOT_CACHE_MAX_AGE_SEC}, s-maxage=${SNAPSHOT_CACHE_MAX_AGE_SEC}, must-revalidate`

type Meta = {
  owner: string
  visibility: 'unlisted' | 'profile-listed'
  revoked_at: number | null
  version: number
}

export const onRequestGet: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    const id = ctx.params.id as string
    if (!isValidSlug(id)) throw new ApiError('NOT_FOUND')

    const metaRaw = await ctx.env.META.get(`meta/${id}`)
    if (!metaRaw) throw new ApiError('NOT_FOUND')
    const meta = JSON.parse(metaRaw) as Meta

    if (meta.revoked_at) {
      return new Response(
        JSON.stringify({ revoked: true, at: meta.revoked_at }),
        { status: 410, headers: TOMBSTONE_HEADERS },
      )
    }
    const obj = await ctx.env.SNAPSHOTS.get(`${id}.json`)
    if (!obj) throw new ApiError('NOT_FOUND')

    return new Response(obj.body as unknown as BodyInit, {
      headers: {
        'content-type': 'application/json',
        'cache-control': SNAPSHOT_CACHE_HEADER,
        etag: `"${id}-${meta.version}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

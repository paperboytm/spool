import type { KVNamespace, PagesFunction, R2Bucket } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../src/errors'
import { isValidSlug } from '../../../src/publish/slug'

type Env = { META: KVNamespace; SNAPSHOTS: R2Bucket; RATE: KVNamespace }

const TOMBSTONE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

type Meta = {
  owner: string
  visibility: 'unlisted' | 'profile-listed'
  expires_at: number | null
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
    if (meta.expires_at && Date.now() > meta.expires_at) {
      return new Response(
        JSON.stringify({ expired: true, at: meta.expires_at }),
        { status: 410, headers: TOMBSTONE_HEADERS },
      )
    }

    const obj = await ctx.env.SNAPSHOTS.get(`${id}.json`)
    if (!obj) throw new ApiError('NOT_FOUND')

    return new Response(obj.body as unknown as BodyInit, {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60, s-maxage=60',
        etag: `"${id}-${meta.version}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

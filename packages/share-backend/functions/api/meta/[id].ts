// Lightweight metadata endpoint for a published share — title, visibility,
// expiry, tombstone state. Used by share-web's /s/<id> Pages Function to
// inject Open Graph / Twitter Card tags without fetching the full snapshot
// (potentially 2 MB) just to read the title. Social crawlers hit /s/<id>
// on every share preview render; routing them through /api/snapshots/:id
// allocates the entire conversation body in Pages Function memory only to
// discard everything but `conversation.title`. /api/meta/:id is the
// purpose-built sidecar — KV-only, <1 KB response.
//
// Title is written into the KV `meta/<slug>` record on publish + republish
// (see publish.ts). Pre-existing shares that were published before that
// field landed will have `title: undefined` here — the response still
// returns 200, the caller renders without a custom OG title, the og:image
// (which is built independently from the snapshot at publish time) still
// renders. Self-heals on the next republish.

import type { KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError } from '../../../src/errors'
import { isValidSlug } from '../../../src/publish/slug'
import { CC_NO_STORE } from '../../../src/security/cache-control'

type Env = { META: KVNamespace }

const TOMBSTONE_HEADERS = {
  'content-type': 'application/json',
  'cache-control': CC_NO_STORE,
}

// Same 30s window as /api/snapshots/:id so a revoke takes the social-card
// preview off-air on the same timeline as the reader page itself.
const META_CACHE_MAX_AGE_SEC = 30
const META_CACHE_HEADER =
  `public, max-age=${META_CACHE_MAX_AGE_SEC}, s-maxage=${META_CACHE_MAX_AGE_SEC}, must-revalidate`

type KvMeta = {
  owner: string
  // Optional for backward compat with shares published before the field
  // was added; new publishes always carry it.
  title?: string
  visibility: 'unlisted' | 'profile-listed'
  expires_at: number | null
  revoked_at: number | null
  version: number
}

export const onRequestGet: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    const id = ctx.params.id as string
    if (!isValidSlug(id)) throw new ApiError('NOT_FOUND')

    const raw = await ctx.env.META.get(`meta/${id}`)
    if (!raw) throw new ApiError('NOT_FOUND')
    const meta = JSON.parse(raw) as KvMeta

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

    // Owner intentionally omitted — same reasoning as /api/snapshots/:id:
    // exposing the internal user id to anyone with a slug would hand
    // them a pivot into a user-enumeration vector via /api/profiles/*.
    const body = {
      title: meta.title ?? null,
      visibility: meta.visibility,
      expires_at: meta.expires_at,
      version: meta.version,
    }
    return new Response(JSON.stringify(body), {
      headers: {
        'content-type': 'application/json',
        'cache-control': META_CACHE_HEADER,
        etag: `"${id}-${meta.version}"`,
      },
    })
  } catch (e) {
    return jsonError(e)
  }
}

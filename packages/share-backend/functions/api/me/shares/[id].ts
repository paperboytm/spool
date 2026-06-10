// PATCH /api/me/shares/:id — owner-scoped visibility change for a live
// share, without the full republish round-trip. POST /api/publish with
// override_slug can also change visibility, but it requires the complete
// snapshot body — which the desktop Shares page doesn't have (rows render
// from cached metadata only). Listing state is metadata, not content, so
// it gets a metadata-sized endpoint.

import type {
  D1Database,
  KVNamespace,
  PagesFunction,
} from '@cloudflare/workers-types'

import { audit } from '../../../../src/audit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { isValidSlug } from '../../../../src/publish/slug'
import { checkRate } from '../../../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  META: KVNamespace
  RATE: KVNamespace
}

// Owner-scoped metadata write — same hourly shape as revoke; the bucket
// caps a leaked-token attacker's D1/KV write loop, nothing more.
const VISIBILITY_RATE_WINDOW_SEC = 3600
const VISIBILITY_RATE_MAX = 60

export const onRequestPatch: PagesFunction<Env, 'id'> = async (ctx) => {
  try {
    const id = ctx.params.id as string
    if (!isValidSlug(id)) throw new ApiError('NOT_FOUND')
    const user = await requireUser(ctx.request, ctx.env)

    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'share-visibility',
      key: user.id,
      windowSec: VISIBILITY_RATE_WINDOW_SEC,
      max: VISIBILITY_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    let body: { visibility?: unknown }
    try {
      body = (await ctx.request.json()) as { visibility?: unknown }
    } catch {
      throw new ApiError('BAD_REQUEST', 'invalid json')
    }
    const visibility = body.visibility
    if (visibility !== 'unlisted' && visibility !== 'profile-listed') {
      throw new ApiError(
        'UNPROCESSABLE',
        "visibility must be 'unlisted' or 'profile-listed'",
      )
    }

    const existing = await ctx.env.DB.prepare(
      'SELECT visibility, revoked_at FROM published_shares WHERE id=? AND user_id=?',
    )
      .bind(id, user.id)
      .first<{ visibility: string; revoked_at: number | null }>()
    // Ownership and existence collapse to one 404 — same enumeration
    // discipline as revoke.
    if (!existing) throw new ApiError('NOT_FOUND')
    // Revoked shares are permanent tombstones; their listing state is
    // meaningless and a write here would desync the frozen audit trail.
    if (existing.revoked_at !== null) throw new ApiError('GONE')
    if (existing.visibility === visibility) {
      // Idempotent — repeat of the current state is a no-op success, so
      // a retry after a dropped response doesn't surface as an error.
      return jsonOk({ ok: true, visibility })
    }

    // Same server-side gate as POST /api/publish: a profile listing
    // without a live handle has no page to appear on.
    if (visibility === 'profile-listed') {
      const h = await ctx.env.DB.prepare(
        'SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL',
      )
        .bind(user.id)
        .first<{ handle: string }>()
      if (!h) throw new ApiError('UNPROCESSABLE', 'profile-listed requires a handle')
    }

    // D1 first (drives /api/me/shares and the /api/profiles listing
    // query), then the KV meta sidecar (/api/meta/:id). The R2 snapshot
    // keeps its publish-time `publish.visibility` — no reader renders
    // it, and rewriting a multi-MB object to flip one cosmetic field
    // isn't worth the partial-failure surface.
    await ctx.env.DB.prepare(
      'UPDATE published_shares SET visibility=? WHERE id=?',
    )
      .bind(visibility, id)
      .run()

    const metaRaw = await ctx.env.META.get(`meta/${id}`)
    if (metaRaw) {
      const m = JSON.parse(metaRaw)
      m.visibility = visibility
      await ctx.env.META.put(`meta/${id}`, JSON.stringify(m))
    }

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'share.visibility',
      target_id: id,
      details: { visibility },
    })
    return jsonOk({ ok: true, visibility })
  } catch (e) {
    return jsonError(e)
  }
}

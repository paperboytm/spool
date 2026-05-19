import type {
  D1Database,
  KVNamespace,
  PagesFunction,
  R2Bucket,
} from '@cloudflare/workers-types'

import { audit } from '../../src/audit'
import { requireUser } from '../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../src/errors'
import { isValidSlug, nanoidSlug } from '../../src/publish/slug'
import { PublishRequest } from '../../src/publish/validators'
import { checkRate } from '../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  META: KVNamespace
  RATE: KVNamespace
  SNAPSHOTS: R2Bucket
}

const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)

    const hourly = await checkRate(ctx.env.RATE, {
      bucket: 'publish-h',
      key: user.id,
      windowSec: 3600,
      max: 30,
    })
    if (!hourly.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const daily = await checkRate(ctx.env.RATE, {
      bucket: 'publish-d',
      key: user.id,
      windowSec: 86400,
      max: 100,
    })
    if (!daily.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const raw = await ctx.request.text()
    if (raw.length > MAX_SNAPSHOT_BYTES) {
      throw new ApiError('UNPROCESSABLE', 'payload too large')
    }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      throw new ApiError('UNPROCESSABLE', 'invalid json')
    }
    const parsed = PublishRequest.safeParse(json)
    if (!parsed.success) {
      throw new ApiError('UNPROCESSABLE', 'invalid snapshot', {
        issues: parsed.error.issues,
      })
    }
    const req = parsed.data

    if (req.visibility === 'profile-listed') {
      const h = await ctx.env.DB.prepare(
        'SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL',
      )
        .bind(user.id)
        .first<{ handle: string }>()
      if (!h) throw new ApiError('UNPROCESSABLE', 'profile-listed requires a handle')
    }

    // Idempotency: if a prior request from this user already landed
    // under the same token, return that result without touching state.
    // Covers the dropped-response retry case (network drops between
    // commit and 200 → user clicks again with the same payload →
    // hash collides → backend short-circuits to the original slug).
    //
    // Skipped when the token already belongs to a revoked row — a
    // republish-after-unpublish must mint a new slug, not resurrect
    // the old one, so we look only at currently-live rows.
    //
    // When the request carries an override_slug (republish path) the
    // short-circuit must only fire if the token's row IS that slug.
    // A token held by a different live share is a hard collision
    // (vanishingly rare in practice — two drafts whose content hash
    // is identical) and surfaces as 409, not a confused 200 with a
    // slug the renderer wasn't expecting.
    const idempotent = await ctx.env.DB.prepare(
      'SELECT id, version FROM published_shares WHERE user_id=? AND client_request_id=? AND revoked_at IS NULL',
    )
      .bind(user.id, req.idempotency_key)
      .first<{ id: string; version: number }>()
    if (idempotent) {
      if (req.override_slug && idempotent.id !== req.override_slug) {
        throw new ApiError('CONFLICT', 'another live share carries the same idempotency token; edit content or revoke the other share')
      }
      return jsonOk({
        id: idempotent.id,
        version: idempotent.version,
        url: `${publicBaseUrl(ctx.env)}/s/${idempotent.id}`,
      })
    }

    const isRepublish = !!req.override_slug
    let slug: string
    let version: number
    if (isRepublish) {
      if (!isValidSlug(req.override_slug!)) throw new ApiError('BAD_REQUEST', 'bad slug')
      // Read draft_id alongside version so we can reject a republish
      // that's trying to retarget an existing slug to a different draft —
      // the slug ↔ draft binding is meant to be stable for the slug's
      // lifetime.
      const owned = await ctx.env.DB.prepare(
        'SELECT version, draft_id FROM published_shares WHERE id=? AND user_id=? AND revoked_at IS NULL',
      )
        .bind(req.override_slug, user.id)
        .first<{ version: number; draft_id: string | null }>()
      if (!owned) throw new ApiError('NOT_FOUND', 'not owner / not found')
      // owned.draft_id can be null for shares published before the
      // column existed. In that case we accept the incoming draft_id
      // and write it through on the UPDATE — the row gets healed.
      if (owned.draft_id !== null && owned.draft_id !== req.draft_id) {
        throw new ApiError('BAD_REQUEST', 'draft_id does not match slug')
      }
      slug = req.override_slug!
      version = owned.version + 1
    } else {
      slug = nanoidSlug()
      version = 1
    }

    const publishedAt = new Date().toISOString()
    const fullSnap = {
      ...req.snapshot,
      id: slug,
      owner_user_id: user.id,
      publish: {
        visibility: req.visibility,
        expires_at: req.expires_at,
        published_at: publishedAt,
        version,
      },
    }
    await ctx.env.SNAPSHOTS.put(`${slug}.json`, JSON.stringify(fullSnap), {
      httpMetadata: { contentType: 'application/json' },
    })

    const meta = {
      owner: user.id,
      visibility: req.visibility,
      expires_at: req.expires_at ? new Date(req.expires_at).getTime() : null,
      revoked_at: null as number | null,
      version,
    }
    await ctx.env.META.put(`meta/${slug}`, JSON.stringify(meta))

    const now = Date.now()
    if (isRepublish) {
      await ctx.env.DB.prepare(
        'UPDATE published_shares SET title=?, visibility=?, expires_at=?, version=?, republished_at=? WHERE id=?',
      )
        .bind(
          req.snapshot.conversation.title,
          req.visibility,
          meta.expires_at,
          version,
          now,
          slug,
        )
        .run()
    } else {
      await ctx.env.DB.prepare(
        'INSERT INTO published_shares (id, user_id, title, visibility, expires_at, version, published_at) VALUES (?,?,?,?,?,?,?)',
      )
        .bind(
          slug,
          user.id,
          req.snapshot.conversation.title,
          req.visibility,
          meta.expires_at,
          version,
          now,
        )
          .bind(
            slug,
            user.id,
            req.snapshot.conversation.title,
            req.visibility,
            expiresAtMs,
            version,
            now,
            req.draft_id,
            req.idempotency_key,
          )
          .run()
      } catch (insertErr) {
        // Concurrent retry: the idempotency SELECT above raced an
        // in-flight publish that committed between our read and write.
        // The UNIQUE(user_id, client_request_id) partial index fires
        // and we land here. Re-resolve the now-existing row and return
        // it, so both racing requests get the same response instead of
        // one of them seeing an unhelpful constraint error.
        const msg = insertErr instanceof Error ? insertErr.message : String(insertErr)
        if (!/UNIQUE constraint/i.test(msg)) throw insertErr
        const settled = await ctx.env.DB.prepare(
          'SELECT id, version FROM published_shares WHERE user_id=? AND client_request_id=? AND revoked_at IS NULL',
        )
          .bind(user.id, req.idempotency_key)
          .first<{ id: string; version: number }>()
        if (!settled) throw insertErr
        return jsonOk({
          id: settled.id,
          version: settled.version,
          url: `${publicBaseUrl(ctx.env)}/s/${settled.id}`,
        })
      }
    }

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: isRepublish ? 'republish' : 'publish',
      target_id: slug,
      details: { version, visibility: req.visibility },
    })

    return jsonOk({
      id: slug,
      version,
      url: `https://spool.pro/s/${slug}`,
    })
  } catch (e) {
    return jsonError(e)
  }
}

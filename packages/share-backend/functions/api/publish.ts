import type {
  D1Database,
  KVNamespace,
  PagesFunction,
  R2Bucket,
} from '@cloudflare/workers-types'

import { audit } from '../../src/audit'
import { requireUser } from '../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../src/errors'
import { renderOgPng } from '../../src/publish/og'
import { isValidSlug, nanoidSlug } from '../../src/publish/slug'
import { PublishRequest } from '../../src/publish/validators'
import { publicBaseUrl } from '../../src/public-url'
import { checkRate } from '../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  META: KVNamespace
  RATE: KVNamespace
  SNAPSHOTS: R2Bucket
  OG: R2Bucket
  // Origin returned in the published share URL. Dev points this at the
  // local share-web vite server; prod defaults to spool.pro.
  PUBLIC_BASE_URL?: string
}

// Hard cap on the raw request body — 10× the typical session export, low
// enough that a single user can't fill R2 with a few shares.
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

// Per-user publish throttles. The hourly bucket brakes runaway scripts,
// the daily bucket caps overall storage growth per user.
const PUBLISH_RATE_HOURLY_WINDOW_SEC = 3600
const PUBLISH_RATE_HOURLY_MAX = 30
const PUBLISH_RATE_DAILY_WINDOW_SEC = 86400
const PUBLISH_RATE_DAILY_MAX = 100

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)

    const hourly = await checkRate(ctx.env.RATE, {
      bucket: 'publish-h',
      key: user.id,
      windowSec: PUBLISH_RATE_HOURLY_WINDOW_SEC,
      max: PUBLISH_RATE_HOURLY_MAX,
    })
    if (!hourly.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const daily = await checkRate(ctx.env.RATE, {
      bucket: 'publish-d',
      key: user.id,
      windowSec: PUBLISH_RATE_DAILY_WINDOW_SEC,
      max: PUBLISH_RATE_DAILY_MAX,
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

    const now = Date.now()

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
    let priorVersion: number | null = null
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
      priorVersion = owned.version
      version = owned.version + 1
    } else {
      slug = nanoidSlug()
      version = 1
    }

    // Write order is deliberate: D1 → META (KV) → R2. The D1 row is the
    // single source of truth for "this slug exists and the user owns it";
    // until it's in place the user has no way to see or revoke the share.
    // KV is the tombstone gate and R2 the bulk body. Partial failures
    // after this point are user-recoverable (republish refreshes both),
    // whereas a public R2 object without a D1 row would be an orphan the
    // owner doesn't even know about.
    if (isRepublish) {
      // Optimistic-concurrency guard against a concurrent republish on the
      // same row: scope the UPDATE to the version we just SELECTed. If a
      // racing writer landed first, meta.changes will be 0 and we surface
      // CONFLICT instead of silently overwriting their result.
      // We also write draft_id on every republish to heal pre-existing
      // rows that landed before the column was added, and write the new
      // idempotency token so future retries hit the short-circuit above.
      try {
        const result = await ctx.env.DB.prepare(
          'UPDATE published_shares SET title=?, visibility=?, version=?, republished_at=?, draft_id=?, client_request_id=? WHERE id=? AND user_id=? AND version=?',
        )
          .bind(
            req.snapshot.conversation.title,
            req.visibility,
            version,
            now,
            req.draft_id,
            req.idempotency_key,
            slug,
            user.id,
            priorVersion!,
          )
          .run()
        if (result.meta.changes === 0) {
          throw new ApiError('CONFLICT', 'concurrent republish — please retry')
        }
      } catch (updateErr) {
        if (updateErr instanceof ApiError) throw updateErr
        // The (user_id, client_request_id) unique index covers live rows.
        // It can fire on republish only when the *same user* has another
        // live share whose token also happens to equal this republish's
        // token — i.e. two distinct drafts whose snapshot+visibility
        // hash to the same content. Vanishingly rare in practice
        // (copy-pasted draft body across two share entries), but we
        // translate it into 409 instead of 500 so the renderer can
        // surface "edit your content or unpublish the other share".
        const msg = updateErr instanceof Error ? updateErr.message : String(updateErr)
        if (/UNIQUE constraint/i.test(msg)) {
          throw new ApiError('CONFLICT', 'another live share carries the same idempotency token; edit content or revoke the other share')
        }
        throw updateErr
      }
    } else {
      try {
        await ctx.env.DB.prepare(
          'INSERT INTO published_shares (id, user_id, title, visibility, version, published_at, draft_id, client_request_id) VALUES (?,?,?,?,?,?,?,?)',
        )
          .bind(
            slug,
            user.id,
            req.snapshot.conversation.title,
            req.visibility,
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

    // Write audit right after the authoritative D1 mutation so the
    // evidence row exists even if the downstream META/R2 writes fail
    // partway. audit() itself writes to D1, so its outcome shares the
    // same blast radius as the row it's recording.
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: isRepublish ? 'republish' : 'publish',
      target_id: slug,
      details: { version, visibility: req.visibility },
    })

    // `title` is stored in KV alongside the lifecycle metadata so
    // /api/meta/:id can answer with a tiny payload (<1KB) instead of
    // forcing share-web's OG Pages Function to fetch the full 2MB
    // snapshot just to extract the title for the social-card preview.
    // Republish bumps the version and may have edited the title, so
    // the KV write always carries the latest value (this code path
    // runs after the D1 UPDATE for republish too).
    const meta = {
      owner: user.id,
      title: req.snapshot.conversation.title,
      visibility: req.visibility,
      revoked_at: null as number | null,
      version,
    }
    await ctx.env.META.put(`meta/${slug}`, JSON.stringify(meta))

    // Drop owner_user_id from the public JSON: reader doesn't need it, and
    // exposing the internal id lets anyone with a share URL pivot to a
    // user enumeration vector. Author identity belongs in /api/profiles/*.
    const fullSnap = {
      ...req.snapshot,
      id: slug,
      publish: {
        visibility: req.visibility,
        published_at: new Date(now).toISOString(),
        version,
      },
    }
    await ctx.env.SNAPSHOTS.put(`${slug}.json`, JSON.stringify(fullSnap), {
      httpMetadata: { contentType: 'application/json' },
    })

    ctx.waitUntil((async () => {
      try {
        const png = await renderOgPng(fullSnap)
        await ctx.env.OG.put(`${slug}.png`, png, {
          httpMetadata: { contentType: 'image/png' },
        })
      } catch (e) {
        // OG is non-critical; log so a broken renderer is visible without
        // failing the publish response.
        console.error('og render failed for', slug, e)
      }
    })())

    return jsonOk({
      id: slug,
      version,
      url: `${publicBaseUrl(ctx.env)}/s/${slug}`,
    })
  } catch (e) {
    return jsonError(e)
  }
}

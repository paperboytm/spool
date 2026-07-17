// POST /api/me/avatar — multipart upload, MIME sniff, EXIF strip, R2
//                       put, D1 commit. Returns { avatar_id, url }.
//
// DELETE /api/me/avatar — drop the custom avatar from R2 + D1. The
//                         provider-claim avatar (users.avatar_url)
//                         is unaffected.
//
// Backend-proxied upload: the bytes go through the Pages Function so we
// can sniff the MIME from the bytes (not the client-claimed
// Content-Type), strip metadata, cap dimensions, and only then commit
// to R2. Cap 2 MB, accepts PNG/JPEG/WebP. Resize/transcode is out of
// scope for v1 — the dimension cap is the only protection against
// pathological inputs.

import type { D1Database, KVNamespace, PagesFunction, R2Bucket } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import {
  MAX_AVATAR_BYTES,
  MAX_AVATAR_DIM,
  MIN_AVATAR_DIM,
  readDimensions,
  sniffMime,
  stripMetadata,
} from '../../../src/profile/image'
import { checkRate } from '../../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  AVATARS: R2Bucket
}

// Per-user upload throttle. Not a security bound — that's the body
// cap + auth gate — just protects R2 from a runaway re-upload loop.
const AVATAR_UPLOAD_WINDOW_SEC = 3600
const AVATAR_UPLOAD_MAX = 10

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

function newAvatarId(): string {
  // 16 bytes hex — collision-resistant for user-scoped keys, short
  // enough to fit in a URL path segment.
  const buf = new Uint8Array(16)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  // Observability: log the inbound shape so we can pinpoint *which*
  // step of the pipeline rejected a request. Without this the only
  // signal is a generic 422 in wrangler's access log.
  const ct = ctx.request.headers.get('content-type') ?? '<missing>'
  const cl = ctx.request.headers.get('content-length') ?? '<missing>'
  console.log(`[avatar-upload] in: content-type="${ct}" content-length=${cl}`)
  try {
    const user = await requireUser(ctx.request, ctx.env)

    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'avatar-upload',
      key: user.id,
      windowSec: AVATAR_UPLOAD_WINDOW_SEC,
      max: AVATAR_UPLOAD_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    // multipart/form-data with a single "avatar" file field. Workers'
    // request.formData() handles streaming + boundary parsing for us.
    let form: FormData
    try {
      form = await ctx.request.formData()
    } catch (e) {
      console.log(`[avatar-upload] formData() threw: ${e instanceof Error ? e.message : String(e)}`)
      throw new ApiError('UNPROCESSABLE', 'invalid multipart body')
    }
    const fieldNames = Array.from(form.keys())
    console.log(`[avatar-upload] form fields: [${fieldNames.join(', ')}]`)
    const file = form.get('avatar')
    if (!file || typeof file === 'string') {
      console.log(`[avatar-upload] avatar field present=${!!file} typeof=${typeof file}`)
      throw new ApiError('UNPROCESSABLE', 'missing avatar file field')
    }

    const ab = await (file as File).arrayBuffer()
    console.log(`[avatar-upload] file bytes=${ab.byteLength} name=${(file as File).name} type=${(file as File).type}`)
    if (ab.byteLength === 0) throw new ApiError('UNPROCESSABLE', 'empty upload')
    if (ab.byteLength > MAX_AVATAR_BYTES) {
      throw new ApiError('UNPROCESSABLE', 'avatar too large (max 2 MB)')
    }
    const raw = new Uint8Array(ab)

    // 1. Sniff MIME from bytes (not Content-Type header).
    const mime = sniffMime(raw)
    console.log(`[avatar-upload] sniffMime=${mime ?? 'null'} first4=${Array.from(raw.slice(0, 4)).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
    if (!mime) {
      throw new ApiError('UNPROCESSABLE', 'unsupported image format (PNG/JPEG/WebP only)')
    }

    // 2. Bound dimensions BEFORE writing to R2. A 4K JPEG is fine; a
    //    forged "10000x10000" PNG header that decodes into a 10 GB
    //    framebuffer is not. We don't decode here — just refuse
    //    anything that claims absurd dimensions.
    const dims = readDimensions(mime, raw)
    console.log(`[avatar-upload] dims=${dims ? `${dims.width}x${dims.height}` : 'null'}`)
    if (!dims) throw new ApiError('UNPROCESSABLE', 'malformed image header')
    if (dims.width < MIN_AVATAR_DIM || dims.height < MIN_AVATAR_DIM) {
      throw new ApiError('UNPROCESSABLE', `avatar too small (min ${MIN_AVATAR_DIM}x${MIN_AVATAR_DIM})`)
    }
    if (dims.width > MAX_AVATAR_DIM || dims.height > MAX_AVATAR_DIM) {
      throw new ApiError('UNPROCESSABLE', `avatar too large (max ${MAX_AVATAR_DIM}x${MAX_AVATAR_DIM})`)
    }

    // 3. Strip metadata — drops EXIF GPS, capture timestamps, ICC
    //    profiles, XMP, embedded text. Output keeps the same format
    //    (no transcode).
    const stripped = stripMetadata(mime, raw)

    // 4. Read old avatar id so we can delete it AFTER the new write
    //    lands. Order: new R2 → D1 row → old R2 cleanup. If anything
    //    fails before the D1 row update, the new R2 object is
    //    orphaned but the user still sees their old avatar.
    const existing = await ctx.env.DB
      .prepare('SELECT custom_avatar_id FROM users WHERE id=?')
      .bind(user.id)
      .first<{ custom_avatar_id: string | null }>()

    const id = newAvatarId()
    const ext = EXT_BY_MIME[mime]
    const key = `avatars/${user.id}/${id}.${ext}`

    await ctx.env.AVATARS.put(key, stripped, {
      httpMetadata: { contentType: mime },
    })

    await ctx.env.DB
      .prepare('UPDATE users SET custom_avatar_id=?, avatar_visible=1 WHERE id=?')
      .bind(`${id}.${ext}`, user.id)
      .run()

    // Best-effort cleanup of the prior file.
    if (existing?.custom_avatar_id) {
      const oldKey = `avatars/${user.id}/${existing.custom_avatar_id}`
      ctx.waitUntil(ctx.env.AVATARS.delete(oldKey).catch(() => undefined))
    }

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'profile.avatar.upload',
      details: { mime, width: dims.width, height: dims.height, bytes: stripped.byteLength },
    })

    return jsonOk({
      avatar_id: `${id}.${ext}`,
      url: `/api/avatars/${user.id}`,
    })
  } catch (e) {
    if (e instanceof ApiError) {
      console.log(`[avatar-upload] reject: code=${e.code} detail=${e.detail ?? ''}`)
    } else {
      console.log(`[avatar-upload] uncaught: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
    }
    return jsonError(e)
  }
}

export const onRequestDelete: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)

    const existing = await ctx.env.DB
      .prepare('SELECT custom_avatar_id FROM users WHERE id=?')
      .bind(user.id)
      .first<{ custom_avatar_id: string | null }>()

    if (!existing?.custom_avatar_id) {
      // Idempotent — already gone. Matches the revoke endpoint shape
      // post-#369.
      return jsonOk({ ok: true })
    }

    // Reset avatar_visible too so removing the custom avatar always
    // reverts to "show the provider photo if any, else initials" —
    // otherwise a previously-hidden provider stays hidden and the user
    // ends up with initials when they expected their Google photo back.
    await ctx.env.DB
      .prepare('UPDATE users SET custom_avatar_id=NULL, avatar_visible=1 WHERE id=?')
      .bind(user.id)
      .run()

    const key = `avatars/${user.id}/${existing.custom_avatar_id}`
    ctx.waitUntil(ctx.env.AVATARS.delete(key).catch(() => undefined))

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'profile.avatar.delete',
    })

    return jsonOk({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

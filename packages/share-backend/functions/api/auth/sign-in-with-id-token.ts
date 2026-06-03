import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { verifyIdToken } from '../../../src/auth/jwks'
import { createSession } from '../../../src/auth/session'
import { audit } from '../../../src/audit'
import { ApiError, jsonError } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import { clientIp } from '../../../src/request'
import { upsertUserByGoogleSub } from '../../../src/store/d1'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  NONCE: KVNamespace
  GOOGLE_CLIENT_ID_DESKTOP: string
}

type Body = { id_token: string; nonce: string }

// Rate limit: 10 desktop sign-ins per IP per minute. Tight enough to
// brake brute-force attempts, loose enough that a quick retry after a
// transient Google failure still goes through. Exported so the test
// suite can pre-fill the counter without copy-pasting the values.
export const SIGNIN_RATE_WINDOW_SEC = 60
export const SIGNIN_RATE_MAX = 10
// Nonce replay window. Spans the time between desktop minting the
// nonce + id_token and forwarding to us. 10 minutes is generous.
const NONCE_TTL_SEC = 10 * 60

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'signin',
      key: clientIp(ctx.request),
      windowSec: SIGNIN_RATE_WINDOW_SEC,
      max: SIGNIN_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    let body: Body
    try {
      body = (await ctx.request.json()) as Body
    } catch {
      throw new ApiError('BAD_REQUEST', 'invalid json')
    }
    if (!body?.id_token || !body?.nonce) {
      throw new ApiError('BAD_REQUEST', 'missing fields')
    }

    // Pre-check so a replayed token still 403s; verify also binds nonce.
    const usedKey = `nonce/${body.nonce}`
    const seen = await ctx.env.NONCE.get(usedKey)
    if (seen) throw new ApiError('FORBIDDEN', 'nonce replay')

    const claims = await verifyIdToken(body.id_token, {
      audience: ctx.env.GOOGLE_CLIENT_ID_DESKTOP,
      nonce: body.nonce,
    })

    await ctx.env.NONCE.put(usedKey, '1', { expirationTtl: NONCE_TTL_SEC })

    if (!claims.email) throw new ApiError('BAD_REQUEST', 'no email')
    const user = await upsertUserByGoogleSub(
      ctx.env.DB,
      claims.sub,
      claims.email,
      claims.name ?? null,
      claims.picture ?? null,
    )
    const sess = await createSession(ctx.env.SESSIONS, user.id)
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'signin.desktop',
    })

    return new Response(
      JSON.stringify({
        session_token: sess.token,
        exp: sess.exp,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar_url: user.avatar_url,
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  } catch (e) {
    return jsonError(e)
  }
}

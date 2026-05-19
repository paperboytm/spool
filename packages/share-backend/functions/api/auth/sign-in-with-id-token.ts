import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { verifyIdToken } from '../../../src/auth/jwks'
import { createSession } from '../../../src/auth/session'
import { audit } from '../../../src/audit'
import { ApiError, jsonError } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import { upsertUserByGoogleSub } from '../../../src/store/d1'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  NONCE: KVNamespace
  GOOGLE_CLIENT_ID_DESKTOP: string
}

type Body = { id_token: string; nonce: string }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const ip = ctx.request.headers.get('CF-Connecting-IP') ?? '0.0.0.0'
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'signin',
      key: ip,
      windowSec: 60,
      max: 10,
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

    // Nonce single-use: check BEFORE verifying so a replayed valid token
    // still gets a clean FORBIDDEN. The verify itself also binds to nonce.
    const usedKey = `nonce/${body.nonce}`
    const seen = await ctx.env.NONCE.get(usedKey)
    if (seen) throw new ApiError('FORBIDDEN', 'nonce replay')

    const claims = await verifyIdToken(body.id_token, {
      audience: ctx.env.GOOGLE_CLIENT_ID_DESKTOP,
      nonce: body.nonce,
    })

    await ctx.env.NONCE.put(usedKey, '1', { expirationTtl: 600 })

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

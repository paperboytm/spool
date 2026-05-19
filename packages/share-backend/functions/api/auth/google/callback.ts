import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  buildSessionCookie,
  clearCookie,
  readCookie,
} from '../../../../src/auth/cookie'
import { verifyIdToken } from '../../../../src/auth/jwks'
import { createSession } from '../../../../src/auth/session'
import { audit } from '../../../../src/audit'
import { ApiError, jsonError } from '../../../../src/errors'
import { upsertUserByGoogleSub } from '../../../../src/store/d1'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  GOOGLE_CLIENT_ID_WEB: string
  GOOGLE_CLIENT_SECRET_WEB: string
}

function safeNext(raw: string | undefined): string {
  if (!raw) return '/'
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return '/'
  return raw
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const url = new URL(ctx.request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code || !state) throw new ApiError('BAD_REQUEST')

    const stateCookie = readCookie(ctx.request, OAUTH_STATE_COOKIE)
    const verifier = readCookie(ctx.request, OAUTH_VERIFIER_COOKIE)
    if (!stateCookie || !verifier) throw new ApiError('BAD_REQUEST', 'no state')
    const [cookieState, rawNext] = stateCookie.split('|')
    if (cookieState !== state) throw new ApiError('FORBIDDEN', 'state mismatch')
    const next = safeNext(rawNext)

    const redirectUri = `${url.origin}/api/auth/google/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: ctx.env.GOOGLE_CLIENT_ID_WEB,
        client_secret: ctx.env.GOOGLE_CLIENT_SECRET_WEB,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    })
    if (!tokenRes.ok) throw new ApiError('FORBIDDEN', 'token exchange')
    const tokens = (await tokenRes.json()) as { id_token: string }
    const claims = await verifyIdToken(tokens.id_token, {
      audience: ctx.env.GOOGLE_CLIENT_ID_WEB,
    })

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
      action: 'signin.web',
    })

    const headers = new Headers({ Location: next })
    headers.append('Set-Cookie', buildSessionCookie(sess.token, 30 * 24 * 3600))
    headers.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE))
    headers.append('Set-Cookie', clearCookie(OAUTH_VERIFIER_COOKIE))
    return new Response(null, { status: 302, headers })
  } catch (e) {
    return jsonError(e)
  }
}

import type { PagesFunction } from '@cloudflare/workers-types'

import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  buildOauthCookie,
} from '../../../../src/auth/cookie'
import { safeNext } from '../../../../src/auth/next'
import { pkceChallenge, randomUrlSafe } from '../../../../src/auth/pkce'
import { publicBaseUrl } from '../../../../src/public-url'

type Env = {
  GOOGLE_CLIENT_ID_WEB: string
  // Public origin Google must redirect back to — must exactly match the
  // value registered in the Google client. Defaults to spool.pro; dev
  // sets it to the share-web origin (e.g. http://localhost:3002).
  PUBLIC_BASE_URL?: string
}

// 192 bits of CSRF entropy — orders of magnitude beyond the threat model.
const STATE_BYTES = 24
// RFC 7636 §4.1: PKCE verifier must be 43–128 chars after base64url.
// 64 random bytes → 86 chars, comfortably inside the window.
const PKCE_VERIFIER_BYTES = 64

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url)
  const next = safeNext(url.searchParams.get('next'))
  const state = randomUrlSafe(STATE_BYTES)
  const verifier = randomUrlSafe(PKCE_VERIFIER_BYTES)
  const challenge = await pkceChallenge(verifier)

  // redirect_uri MUST come from PUBLIC_BASE_URL, not the request's own
  // origin: when dev runs through share-web's vite proxy the request
  // arrives at the backend (8788) but the URI registered with Google is
  // the share-web origin (3002). Using ctx.request.url here causes a
  // 400 redirect_uri_mismatch on every dev sign-in.
  const redirectUri = `${publicBaseUrl(ctx.env)}/api/auth/google/callback`
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  auth.searchParams.set('client_id', ctx.env.GOOGLE_CLIENT_ID_WEB)
  auth.searchParams.set('redirect_uri', redirectUri)
  auth.searchParams.set('response_type', 'code')
  auth.searchParams.set('scope', 'openid email profile')
  auth.searchParams.set('state', state)
  auth.searchParams.set('code_challenge', challenge)
  auth.searchParams.set('code_challenge_method', 'S256')
  auth.searchParams.set('prompt', 'select_account')

  const headers = new Headers({ Location: auth.toString() })
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_STATE_COOKIE, `${state}|${next}`))
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_VERIFIER_COOKIE, verifier))
  return new Response(null, { status: 302, headers })
}

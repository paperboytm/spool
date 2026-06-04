// Provider-agnostic OAuth start. The provider segment of the URL
// (e.g. /api/auth/google/start) is read from ctx.params.provider and
// resolved against the registry — unknown providers return 404 so
// scanners can't enumerate which ones we plan to support next.

import type { PagesFunction } from '@cloudflare/workers-types'

import { getProvider } from '../../../../src/auth/providers/registry'
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
  // Public origin the provider must redirect back to — must exactly
  // match the value registered with the provider. Defaults to
  // spool.pro; dev sets it to the share-web origin (e.g. http://localhost:3002).
  PUBLIC_BASE_URL?: string
}

// 192 bits of CSRF entropy — orders of magnitude beyond the threat model.
const STATE_BYTES = 24
// RFC 7636 §4.1: PKCE verifier must be 43–128 chars after base64url.
// 64 random bytes → 86 chars, comfortably inside the window.
const PKCE_VERIFIER_BYTES = 64

export const onRequestGet: PagesFunction<Env, 'provider'> = async (ctx) => {
  const providerId = ctx.params.provider
  const provider = typeof providerId === 'string' ? getProvider(providerId) : null
  if (!provider) {
    return new Response('Not found', { status: 404 })
  }

  const url = new URL(ctx.request.url)
  const next = safeNext(url.searchParams.get('next'))
  const state = randomUrlSafe(STATE_BYTES)
  const verifier = randomUrlSafe(PKCE_VERIFIER_BYTES)
  const challenge = await pkceChallenge(verifier)

  // redirect_uri MUST come from PUBLIC_BASE_URL, not the request's own
  // origin: when dev runs through share-web's vite proxy the request
  // arrives at the backend (8788) but the URI registered with the
  // provider is the share-web origin (3002). Using ctx.request.url
  // here causes a 400 redirect_uri_mismatch on every dev sign-in.
  const redirectUri = `${publicBaseUrl(ctx.env)}/api/auth/${provider.id}/callback`
  const authorizeUrl = provider.buildAuthRequestUrl(
    { state, codeChallenge: challenge, redirectUri },
    ctx.env,
  )

  const headers = new Headers({ Location: authorizeUrl })
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_STATE_COOKIE, `${state}|${next}`))
  headers.append('Set-Cookie', buildOauthCookie(OAUTH_VERIFIER_COOKIE, verifier))
  return new Response(null, { status: 302, headers })
}

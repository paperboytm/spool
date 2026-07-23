// Provider-agnostic OAuth callback. Resolves ctx.params.provider, calls
// provider.exchangeCode → IdentityClaim, then upserts the user via the
// identity-table store path. Same shape as the old /api/auth/google/
// callback, just plumbed through the provider abstraction.

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../../src/audit'
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  buildSessionCookie,
  clearCookie,
  readCookie,
} from '../../../../src/auth/cookie'
import { safeNext } from '../../../../src/auth/next'
import { getProvider } from '../../../../src/auth/providers/registry'
import { MAX_TTL_SEC, createSession } from '../../../../src/auth/session'
import { ApiError, jsonError } from '../../../../src/errors'
import { oauthPublicBaseUrl, publicBaseUrl } from '../../../../src/public-url'
import { checkRate } from '../../../../src/rate-limit'
import { clientIp } from '../../../../src/request'
import { CC_NO_STORE } from '../../../../src/security/cache-control'
import { upsertUserByIdentity } from '../../../../src/store/d1'
import { opportunisticallyDrainWorkosCleanup } from '../../../../src/teams/cleanup'
import { syncWorkosMemberships } from '../../../../src/teams/sync'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  WORKOS_CLIENT_ID?: string
  WORKOS_API_KEY?: string
  DEV_WORKOS_API_URL?: string
  // Must mirror the same value /api/auth/[provider]/start used so the
  // token exchange's redirect_uri is bit-identical to the authorize one.
  PUBLIC_BASE_URL?: string
}

// Same shape as the desktop sign-in throttle so a shared NAT can't lock
// out web users by spamming desktop and vice versa — independent buckets.
const CALLBACK_RATE_WINDOW_SEC = 60
const CALLBACK_RATE_MAX = 10

export const onRequestGet: PagesFunction<Env, 'provider'> = async (ctx) => {
  try {
    const providerId = ctx.params.provider
    const provider = typeof providerId === 'string' ? getProvider(providerId) : null
    if (!provider) throw new ApiError('NOT_FOUND')

    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'oauth-callback',
      key: clientIp(ctx.request),
      windowSec: CALLBACK_RATE_WINDOW_SEC,
      max: CALLBACK_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const url = new URL(ctx.request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    if (!code) throw new ApiError('BAD_REQUEST')

    // AuthKit's hosted invitation flow is allowed to return directly to the
    // application's redirect URI with only an authorization code. Spool must
    // not use that unbound result to create a browser session because the flow
    // did not originate at /start and therefore has no state cookie to bind
    // the browser to the authorization request. Doing so would make login CSRF
    // / session swapping possible.
    //
    // Redeem the one-time code with the confidential-client secret so WorkOS
    // can finish any hosted invitation bookkeeping, but deliberately discard
    // the returned identity instead of creating a Spool session from an
    // unbound browser request. If a stale/expired callback can no longer be
    // redeemed, a fresh sign-in is still the safest recovery path.
    //
    // Then restart a normal Spool-owned authorization flow. The fresh /start
    // request mints state, and the user's new AuthKit session normally makes
    // the second round trip immediate. Canonicalizing through PUBLIC_BASE_URL
    // also moves legacy spool.pro invitations onto spool.new.
    if (!state) {
      const redirectUri = `${publicBaseUrl(ctx.env)}/api/auth/${provider.id}/callback`
      try {
        await provider.exchangeCode({ code, codeVerifier: '', redirectUri }, ctx.env)
      } catch (error) {
        console.warn(
          JSON.stringify({
            message: 'hosted AuthKit callback completion failed before stateful restart',
            provider: provider.id,
            error: error instanceof ApiError ? error.code : 'INTERNAL',
          }),
        )
      }

      const restart = new URL(`/api/auth/${provider.id}/start`, publicBaseUrl(ctx.env))
      restart.searchParams.set('next', '/me')
      return new Response(null, {
        status: 302,
        headers: {
          Location: restart.toString(),
          'Cache-Control': CC_NO_STORE,
          'Referrer-Policy': 'no-referrer',
        },
      })
    }

    const stateCookie = readCookie(ctx.request, OAUTH_STATE_COOKIE)
    const verifier = readCookie(ctx.request, OAUTH_VERIFIER_COOKIE)
    if (!stateCookie || !verifier) throw new ApiError('BAD_REQUEST', 'no state')
    const [cookieState, rawNext] = stateCookie.split('|')
    if (cookieState !== state) throw new ApiError('FORBIDDEN', 'state mismatch')
    const next = safeNext(rawNext)

    // Must match /api/auth/[provider]/start's redirect_uri exactly.
    const redirectUri = `${oauthPublicBaseUrl(ctx.request, ctx.env)}/api/auth/${provider.id}/callback`
    const claim = await provider.exchangeCode(
      { code, codeVerifier: verifier, redirectUri },
      ctx.env,
    )
    const resolveAliasIdentities = provider.resolveAliasIdentities?.bind(provider)
    const user = await upsertUserByIdentity(
      ctx.env.DB,
      claim,
      resolveAliasIdentities
        ? { resolveAliases: () => resolveAliasIdentities(claim.sub, ctx.env) }
        : {},
    )
    // WorkOS transports Organization membership, while D1 owns runtime
    // authorization and role selection. Refresh the local projection before
    // issuing a browser session so a newly-accepted invitation is usable on
    // the first request after sign-in.
    if (claim.provider === 'workos') {
      await syncWorkosMemberships(ctx.env.DB, ctx.env, {
        localUserId: user.id,
        workosUserId: claim.sub,
        email: claim.email,
      })
      ctx.waitUntil(opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env))
    }
    const sess = await createSession(ctx.env.SESSIONS, user.id)
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'signin.web',
      details: { provider: provider.id },
    })

    // safeNext lets through any /-rooted path including UTF-8 characters
    // (browsers / autocomplete history sometimes inject these). The Fetch
    // spec wants Location ASCII-only; encode here so the header is RFC-
    // compliant and workerd stops emitting non-ASCII warnings. encodeURI
    // preserves the path/query delimiters (`/`, `?`, `&`, `=`), so it's
    // an idempotent no-op on the common ASCII paths.
    const headers = new Headers({ Location: encodeURI(next), 'Cache-Control': CC_NO_STORE })
    headers.append('Set-Cookie', buildSessionCookie(sess.token, MAX_TTL_SEC))
    headers.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE))
    headers.append('Set-Cookie', clearCookie(OAUTH_VERIFIER_COOKIE))
    return new Response(null, { status: 302, headers })
  } catch (e) {
    return jsonError(e)
  }
}

// Native (desktop) sign-in completion. The app runs the WorkOS PKCE
// authorize dance in the system browser with a spool:// custom-scheme
// callback and posts the resulting authorization code + verifier here.
// We redeem it with the provider (public-client PKCE — no secret leaves
// the server because none is sent at all), run the exact same upsert +
// legacy-account-linking path as the web callback, and mint a spool KV
// session. Successor to the deleted /api/auth/sign-in-with-id-token:
// same response contract, but authorization codes are single-use at the
// provider, so the old nonce-replay machinery has no equivalent here.

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { getProvider } from '../../../src/auth/providers/registry'
import { createSession } from '../../../src/auth/session'
import { ApiError, jsonError } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import { clientIp } from '../../../src/request'
import { upsertUserByIdentity } from '../../../src/store/d1'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  WORKOS_CLIENT_ID?: string
  WORKOS_API_KEY?: string
}

type Body = { provider?: unknown; code?: unknown; code_verifier?: unknown }

// Rate limit: 10 desktop sign-ins per IP per minute — tight enough to
// brake brute force, loose enough for a quick retry after a transient
// provider failure. Exported for the test suite.
export const SIGNIN_RATE_WINDOW_SEC = 60
export const SIGNIN_RATE_MAX = 10

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
    if (
      typeof body.provider !== 'string' ||
      typeof body.code !== 'string' ||
      typeof body.code_verifier !== 'string' ||
      body.code === '' ||
      body.code_verifier === ''
    ) {
      throw new ApiError('BAD_REQUEST', 'missing fields')
    }

    const provider = getProvider(body.provider)
    if (!provider) throw new ApiError('BAD_REQUEST', 'unknown provider')
    const exchangeNativeCode = provider.exchangeNativeCode?.bind(provider)
    if (!exchangeNativeCode) {
      throw new ApiError('BAD_REQUEST', 'provider has no native flow')
    }

    const claim = await exchangeNativeCode(
      { code: body.code, codeVerifier: body.code_verifier },
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
    const sess = await createSession(ctx.env.SESSIONS, user.id)
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'signin.desktop',
      details: { provider: provider.id },
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

// Desktop (Electron-loopback) sign-in endpoint. The client performs the
// OAuth dance itself (PKCE + system browser → loopback redirect),
// receives a provider id_token + nonce, and POSTs them here. We verify
// + bind the nonce, mint a session, and return the session token + user.
//
// Provider is now an explicit body field; the resolver in
// src/auth/providers/registry decides which verifier to run. Adding
// GitHub means registering a provider that implements
// verifyNativeIdToken — no change to this handler.

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { setDevJwks } from '../../../src/auth/jwks'
import { createSession } from '../../../src/auth/session'
import { getProvider } from '../../../src/auth/providers/registry'
import { audit } from '../../../src/audit'
import { ApiError, jsonError } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import { clientIp } from '../../../src/request'
import { upsertUserByIdentity } from '../../../src/store/d1'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  NONCE: KVNamespace
  GOOGLE_CLIENT_ID_DESKTOP: string
  /** Local dev only — host-prefetched Google JWKS injected by
   *  share-dev.sh (see setDevJwks). Never set in production. */
  DEV_JWKS?: string
}

type Body = { provider: string; id_token: string; nonce: string }

// Rate limit: 10 desktop sign-ins per IP per minute. Tight enough to
// brake brute-force attempts, loose enough that a quick retry after a
// transient provider failure still goes through. Exported so the test
// suite can pre-fill the counter without copy-pasting the values.
export const SIGNIN_RATE_WINDOW_SEC = 60
export const SIGNIN_RATE_MAX = 10
// Nonce replay window. Spans the time between desktop minting the
// nonce + id_token and forwarding to us. 10 minutes is generous.
const NONCE_TTL_SEC = 10 * 60

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    if (ctx.env.DEV_JWKS) setDevJwks(ctx.env.DEV_JWKS)
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
    if (!body?.provider || !body?.id_token || !body?.nonce) {
      throw new ApiError('BAD_REQUEST', 'missing fields')
    }

    const provider = getProvider(body.provider)
    if (!provider) throw new ApiError('BAD_REQUEST', 'unknown provider')

    // Pre-check + reservation: two concurrent requests carrying the
    // same nonce would otherwise both read "unseen", both verify the
    // id_token, and both mint a session — defeating replay protection.
    // The previous order (check → verify → write) left a window equal
    // to one verify + KV round-trip.
    //
    // Order now:
    //   1. read — fail fast on a confirmed replay
    //   2. write the reservation BEFORE verify (succeeds at most once
    //      under realistic KV contention)
    //   3. verify the id_token (also binds nonce inside the JWS)
    //   4. on verify failure, release the reservation so a legitimate
    //      retry with a corrected payload isn't permanently locked out
    //
    // KV is eventually-consistent; this isn't perfect mutual exclusion,
    // but it shrinks the race window to "between read and write" which
    // is materially smaller than "between read and write + verify".
    const usedKey = `nonce/${body.nonce}`
    const seen = await ctx.env.NONCE.get(usedKey)
    if (seen) throw new ApiError('FORBIDDEN', 'nonce replay')

    await ctx.env.NONCE.put(usedKey, '1', { expirationTtl: NONCE_TTL_SEC })

    let claim
    try {
      claim = await provider.verifyNativeIdToken(
        { idToken: body.id_token, nonce: body.nonce },
        ctx.env,
      )
    } catch (verifyErr) {
      // Release the reservation: this token was bad, but the user may
      // legitimately retry with a freshly-minted nonce + id_token. Not
      // releasing would burn the slot for the full 10-minute TTL.
      // Don't await this — a release failure here is acceptable
      // (it just times out instead of being explicit), and we don't
      // want to mask the underlying verification error.
      ctx.waitUntil(ctx.env.NONCE.delete(usedKey).catch(() => undefined))
      throw verifyErr
    }

    const user = await upsertUserByIdentity(ctx.env.DB, claim)
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

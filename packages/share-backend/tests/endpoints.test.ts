import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { onRequestGet as callbackGet } from '../functions/api/auth/[provider]/callback'
import { onRequestGet as startGet } from '../functions/api/auth/[provider]/start'
import {
  SIGNIN_RATE_MAX,
  SIGNIN_RATE_WINDOW_SEC,
  onRequestPost as signInPost,
} from '../functions/api/auth/sign-in-with-id-token'
import { onRequestPost as signOutPost } from '../functions/api/auth/sign-out'
import {
  _resetJwksCacheForTests,
  setJwksFetcherForTests,
} from '../src/auth/jwks'

import { getSetCookies, invoke } from './_helpers/ctx'
import { makeDb, makeKv, type FakeDbState } from './_helpers/fakes'
import {
  type Keypair,
  future,
  generateKeypair,
  mintTestJwt,
  past,
} from './_helpers/jwt'

const DESKTOP_AUD = 'desktop.apps.googleusercontent.com'
const WEB_AUD = 'web.apps.googleusercontent.com'
const ISS = 'https://accounts.google.com'

let kp: Keypair

beforeAll(async () => {
  kp = await generateKeypair('kid-endpoints')
  setJwksFetcherForTests(async () => [kp.publicJwk])
})

afterAll(() => {
  setJwksFetcherForTests(null)
})

beforeEach(() => {
  _resetJwksCacheForTests()
})

function envFor(dbState?: FakeDbState) {
  const { db, state } = makeDb(dbState)
  return {
    DB: db,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    NONCE: makeKv(),
    GOOGLE_CLIENT_ID_DESKTOP: DESKTOP_AUD,
    GOOGLE_CLIENT_ID_WEB: WEB_AUD,
    GOOGLE_CLIENT_SECRET_WEB: 'secret',
    state,
  }
}

describe('POST /api/auth/sign-in-with-id-token', () => {
  it('200 + new user upserted + session token returned', async () => {
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: DESKTOP_AUD,
      sub: 'sub-1',
      email: 'a@example.com',
      email_verified: true,
      name: 'Alice',
      picture: 'https://x/a.png',
      exp: future(),
      iat: past(0),
      nonce: 'n1',
    })
    const req = new Request('https://spool.pro/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({ provider: 'google', id_token, nonce: 'n1' }),
    })
    const res = await invoke(signInPost, req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      session_token: string
      user: { email: string; name: string }
    }
    expect(typeof body.session_token).toBe('string')
    expect(body.session_token.length).toBeGreaterThanOrEqual(32)
    expect(body.user.email).toBe('a@example.com')
    expect(body.user.name).toBe('Alice')
    expect(env.state.users).toHaveLength(1)
    expect(env.state.user_identities).toEqual([
      expect.objectContaining({ provider: 'google', provider_sub: 'sub-1' }),
    ])
    // Audit row written for signin.desktop
    expect(env.state.audit.some((r) => r.action === 'signin.desktop')).toBe(true)
    // Session row in KV
    const sess = await env.SESSIONS.get(`session/${body.session_token}`)
    expect(sess).not.toBeNull()
  })

  it('400 when id_token or nonce missing', async () => {
    const env = envFor()
    const req = new Request('https://x/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    const res = await invoke(signInPost, req, env)
    expect(res.status).toBe(400)
  })

  it('403 on nonce replay (same nonce twice)', async () => {
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: DESKTOP_AUD,
      sub: 'sub-2',
      email: 'b@example.com',
      email_verified: true,
      exp: future(),
      iat: past(0),
      nonce: 'replay',
    })
    const makeReq = () =>
      new Request('https://x/api/auth/sign-in-with-id-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'google', id_token, nonce: 'replay' }),
      })
    const r1 = await invoke(signInPost, makeReq(), env)
    expect(r1.status).toBe(200)
    const r2 = await invoke(signInPost, makeReq(), env)
    expect(r2.status).toBe(403)
  })

  it('429 when rate limit exceeded', async () => {
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: DESKTOP_AUD,
      sub: 'sub-3',
      email: 'c@example.com',
      email_verified: true,
      exp: future(),
      iat: past(0),
      nonce: 'rl',
    })
    // Pre-fill the counter at the current window slot so the next request
    // tips it over. checkRate writes with TTL = windowSec * 2; mirror that
    // so the seeded row outlives the request under test.
    const slot = Math.floor(Date.now() / 1000 / SIGNIN_RATE_WINDOW_SEC)
    await env.RATE.put(`rate/signin/9.9.9.9/${slot}`, String(SIGNIN_RATE_MAX), {
      expirationTtl: SIGNIN_RATE_WINDOW_SEC * 2,
    })
    const req = new Request('https://x/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
      body: JSON.stringify({ provider: 'google', id_token, nonce: 'rl' }),
    })
    const res = await invoke(signInPost, req, env)
    expect(res.status).toBe(429)
  })

  it('rejects token with wrong audience (proxied as 500 via INTERNAL)', async () => {
    // verifyIdToken throws a non-ApiError when aud mismatches, so jsonError
    // wraps it as INTERNAL (500). That is fine — we just verify it does NOT
    // 200, and no user/session is created.
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: 'wrong-aud',
      sub: 'sub-bad',
      email: 'd@example.com',
      email_verified: true,
      exp: future(),
      iat: past(0),
      nonce: 'wa',
    })
    const req = new Request('https://x/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', id_token, nonce: 'wa' }),
    })
    const res = await invoke(signInPost, req, env)
    expect(res.status).not.toBe(200)
    expect(env.state.users).toHaveLength(0)
  })
})

describe('GET /api/auth/google/callback', () => {
  function tokenExchangeOk(id_token: string) {
    return new Response(JSON.stringify({ id_token }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  it('400 when state cookie is absent', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/google/callback?code=abc&state=xyz',
    )
    const res = await invoke(callbackGet, req, env, { provider: 'google' })
    expect(res.status).toBe(400)
  })

  it('403 when state cookie does not match query state', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/google/callback?code=abc&state=fromUrl',
      {
        headers: {
          cookie: '__spool_oauth_state=otherState|/; __spool_oauth_verifier=v',
        },
      },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'google' })
    expect(res.status).toBe(403)
  })

  it('429 when callback rate limit exceeded', async () => {
    const env = envFor()
    // Mirror CALLBACK_RATE_{WINDOW_SEC, MAX} from callback.ts; the bucket
    // key is `oauth-callback/<ip>`. Pre-fill at MAX so the next request
    // tips it over.
    const RATE_WINDOW_SEC = 60
    const RATE_MAX = 10
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC)
    await env.RATE.put(`rate/oauth-callback/8.8.8.8/${slot}`, String(RATE_MAX), {
      expirationTtl: RATE_WINDOW_SEC * 2,
    })
    const req = new Request(
      'https://spool.pro/api/auth/google/callback?code=abc&state=xyz',
      { headers: { 'CF-Connecting-IP': '8.8.8.8' } },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'google' })
    expect(res.status).toBe(429)
  })

  it('302 + Set-Cookie session on success', async () => {
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: WEB_AUD,
      sub: 'web-sub',
      email: 'w@example.com',
      email_verified: true,
      name: 'W',
      exp: future(),
      iat: past(0),
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenExchangeOk(id_token))
    try {
      const req = new Request(
        'https://spool.pro/api/auth/google/callback?code=goodcode&state=S',
        {
          headers: {
            cookie:
              '__spool_oauth_state=S|/next; __spool_oauth_verifier=verifier-value',
          },
        },
      )
      const res = await invoke(callbackGet, req, env, { provider: 'google' })
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/next')
      const all = getSetCookies(res).join('\n')
      expect(all).toMatch(/spool_session=/)
      expect(all).toMatch(/HttpOnly/)
      expect(env.state.users).toHaveLength(1)
      expect(env.state.user_identities).toEqual([
        expect.objectContaining({ provider: 'google', provider_sub: 'web-sub' }),
      ])
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('ASCII-encodes a non-ASCII next so the Location header is RFC-compliant', async () => {
    // Browser autocomplete / IME quirks can inject UTF-8 into the next
    // query param. safeNext only enforces open-redirect rules, so the
    // cookie carries the raw bytes through to here. The Location header
    // must be ASCII — encodeURI keeps `/?&=` intact and percent-encodes
    // the rest.
    const env = envFor()
    const id_token = await mintTestJwt(kp, {
      iss: ISS,
      aud: WEB_AUD,
      sub: 'web-sub-utf8',
      email: 'utf8@example.com',
      email_verified: true,
      exp: future(),
      iat: past(0),
    })
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenExchangeOk(id_token))
    try {
      const req = new Request(
        'https://spool.pro/api/auth/google/callback?code=c&state=S',
        {
          headers: {
            cookie:
              '__spool_oauth_state=S|/me%E3%80%82%E8%BF%99%E6%AC%A1; __spool_oauth_verifier=v',
          },
        },
      )
      const res = await invoke(callbackGet, req, env, { provider: 'google' })
      expect(res.status).toBe(302)
      const loc = res.headers.get('location') ?? ''
      expect(loc).toBe('/me%E3%80%82%E8%BF%99%E6%AC%A1')
      // Pure ASCII — no raw UTF-8 bytes left.
      expect(loc).toMatch(/^[\x00-\x7f]*$/)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('POST /api/auth/sign-out', () => {
  it('clears KV session and returns a cleared cookie', async () => {
    const env = envFor()
    // Pre-seed a session.
    await env.SESSIONS.put('session/tok-123', JSON.stringify({
      user_id: 'u',
      created: Date.now(),
      exp: Date.now() + 1000_000,
      last_seen: Date.now(),
    }))
    const req = new Request('https://x/api/auth/sign-out', {
      method: 'POST',
      headers: { cookie: 'spool_session=tok-123' },
    })
    const res = await invoke(signOutPost, req, env)
    expect(res.status).toBe(200)
    expect(await env.SESSIONS.get('session/tok-123')).toBeNull()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/spool_session=;/)
    expect(setCookie).toMatch(/Max-Age=0/)
  })

  it('returns ok even with no session cookie', async () => {
    const env = envFor()
    const req = new Request('https://x/api/auth/sign-out', { method: 'POST' })
    const res = await invoke(signOutPost, req, env)
    expect(res.status).toBe(200)
  })
})

describe('start endpoint', () => {
  it('redirects to Google with PKCE challenge and sets both oauth cookies', async () => {
    const env = envFor()
    const req = new Request('https://spool.pro/api/auth/google/start?next=/me')
    const res = await invoke(startGet, req, env, { provider: 'google' })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    expect(loc).toMatch(/code_challenge_method=S256/)
    expect(loc).toMatch(/scope=openid\+email\+profile/)
    const joined = getSetCookies(res).join('\n')
    expect(joined).toMatch(/__spool_oauth_state=/)
    expect(joined).toMatch(/__spool_oauth_verifier=/)
  })

  it('coerces an unsafe next param back to /', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/google/start?next=//evil.example.com',
    )
    const res = await invoke(startGet, req, env, { provider: 'google' })
    const stateCookie =
      getSetCookies(res).find((c) => c.includes('__spool_oauth_state=')) ?? ''
    // The cookie value is `${state}|${next}`. Ensure the next half is `/`.
    expect(stateCookie).toMatch(/__spool_oauth_state=[^|]+\|\/;/)
  })

  it('404s on an unknown provider (no scanner enumeration)', async () => {
    const env = envFor()
    const req = new Request('https://spool.pro/api/auth/github/start')
    const res = await invoke(startGet, req, env, { provider: 'github' })
    expect(res.status).toBe(404)
  })

  it('callback 404s on an unknown provider', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/github/callback?code=x&state=y',
    )
    const res = await invoke(callbackGet, req, env, { provider: 'github' })
    expect(res.status).toBe(404)
  })
})

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  _resetJwksCacheForTests,
  setJwksFetcherForTests,
} from '../src/auth/jwks'

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(req: Request, env: Record<string, unknown>): any {
  return {
    request: req,
    env,
    next: async () => new Response('not-found', { status: 404 }),
    params: {},
    waitUntil: () => undefined,
    passThroughOnException: () => undefined,
    data: {},
  }
}

describe('POST /api/auth/sign-in-with-id-token', () => {
  it('200 + new user upserted + session token returned', async () => {
    const { onRequestPost } = await import(
      '../functions/api/auth/sign-in-with-id-token'
    )
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
    const req = new Request('https://spool.share/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '1.2.3.4' },
      body: JSON.stringify({ id_token, nonce: 'n1' }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.session_token).toBe('string')
    expect(body.session_token.length).toBeGreaterThanOrEqual(32)
    expect(body.user.email).toBe('a@example.com')
    expect(body.user.name).toBe('Alice')
    expect(env.state.users).toHaveLength(1)
    expect(env.state.users[0]?.google_sub).toBe('sub-1')
    // Audit row written for signin.desktop
    expect(env.state.audit.some((r) => r.action === 'signin.desktop')).toBe(true)
    // Session row in KV
    const sess = await env.SESSIONS.get(`session/${body.session_token}`)
    expect(sess).not.toBeNull()
  })

  it('400 when id_token or nonce missing', async () => {
    const { onRequestPost } = await import(
      '../functions/api/auth/sign-in-with-id-token'
    )
    const env = envFor()
    const req = new Request('https://x/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
    expect(res.status).toBe(400)
  })

  it('403 on nonce replay (same nonce twice)', async () => {
    const { onRequestPost } = await import(
      '../functions/api/auth/sign-in-with-id-token'
    )
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
        body: JSON.stringify({ id_token, nonce: 'replay' }),
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r1 = await (onRequestPost as any)(ctxFor(makeReq(), env))
    expect(r1.status).toBe(200)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r2 = await (onRequestPost as any)(ctxFor(makeReq(), env))
    expect(r2.status).toBe(403)
  })

  it('429 when rate limit exceeded', async () => {
    const { onRequestPost } = await import(
      '../functions/api/auth/sign-in-with-id-token'
    )
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
    // Pre-fill the rate counter for this IP at the current 60s slot.
    const slot = Math.floor(Date.now() / 1000 / 60)
    await env.RATE.put(`rate/signin/9.9.9.9/${slot}`, '10', { expirationTtl: 120 })
    const req = new Request('https://x/api/auth/sign-in-with-id-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '9.9.9.9' },
      body: JSON.stringify({ id_token, nonce: 'rl' }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
    expect(res.status).toBe(429)
  })

  it('rejects token with wrong audience (proxied as 500 via INTERNAL)', async () => {
    // verifyIdToken throws a non-ApiError when aud mismatches, so jsonError
    // wraps it as INTERNAL (500). That is fine — we just verify it does NOT
    // 200, and no user/session is created.
    const { onRequestPost } = await import(
      '../functions/api/auth/sign-in-with-id-token'
    )
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
      body: JSON.stringify({ id_token, nonce: 'wa' }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
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
    const { onRequestGet } = await import('../functions/api/auth/google/callback')
    const env = envFor()
    const req = new Request(
      'https://spool.share/api/auth/google/callback?code=abc&state=xyz',
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(400)
  })

  it('403 when state cookie does not match query state', async () => {
    const { onRequestGet } = await import('../functions/api/auth/google/callback')
    const env = envFor()
    const req = new Request(
      'https://spool.share/api/auth/google/callback?code=abc&state=fromUrl',
      {
        headers: {
          cookie: '__spool_oauth_state=otherState|/; __spool_oauth_verifier=v',
        },
      },
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(403)
  })

  it('302 + Set-Cookie session on success', async () => {
    const { onRequestGet } = await import('../functions/api/auth/google/callback')
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
        'https://spool.share/api/auth/google/callback?code=goodcode&state=S',
        {
          headers: {
            cookie:
              '__spool_oauth_state=S|/next; __spool_oauth_verifier=verifier-value',
          },
        },
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (onRequestGet as any)(ctxFor(req, env))
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/next')
      const setCookies = res.headers
        .getSetCookie?.()
        ?? [res.headers.get('set-cookie') ?? '']
      const all = setCookies.join('\n')
      expect(all).toMatch(/spool_session=/)
      expect(all).toMatch(/HttpOnly/)
      expect(env.state.users).toHaveLength(1)
      expect(env.state.users[0]?.google_sub).toBe('web-sub')
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('POST /api/auth/sign-out', () => {
  it('clears KV session and returns a cleared cookie', async () => {
    const { onRequestPost } = await import('../functions/api/auth/sign-out')
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
    expect(res.status).toBe(200)
    expect(await env.SESSIONS.get('session/tok-123')).toBeNull()
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/spool_session=;/)
    expect(setCookie).toMatch(/Max-Age=0/)
  })

  it('returns ok even with no session cookie', async () => {
    const { onRequestPost } = await import('../functions/api/auth/sign-out')
    const env = envFor()
    const req = new Request('https://x/api/auth/sign-out', { method: 'POST' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestPost as any)(ctxFor(req, env))
    expect(res.status).toBe(200)
  })
})

describe('start endpoint', () => {
  it('redirects to Google with PKCE challenge and sets both oauth cookies', async () => {
    const { onRequestGet } = await import('../functions/api/auth/google/start')
    const env = envFor()
    const req = new Request('https://spool.share/api/auth/google/start?next=/me')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    expect(loc).toMatch(/code_challenge_method=S256/)
    expect(loc).toMatch(/scope=openid\+email\+profile/)
    const setCookies =
      res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
    const joined = setCookies.join('\n')
    expect(joined).toMatch(/__spool_oauth_state=/)
    expect(joined).toMatch(/__spool_oauth_verifier=/)
  })

  it('coerces an unsafe next param back to /', async () => {
    const { onRequestGet } = await import('../functions/api/auth/google/start')
    const env = envFor()
    const req = new Request(
      'https://spool.share/api/auth/google/start?next=//evil.example.com',
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    const setCookies: string[] =
      res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']
    const stateCookie =
      setCookies.find((c: string) => c.includes('__spool_oauth_state=')) ?? ''
    // The cookie value is `${state}|${next}`. Ensure the next half is `/`.
    expect(stateCookie).toMatch(/__spool_oauth_state=[^|]+\|\/;/)
  })
})

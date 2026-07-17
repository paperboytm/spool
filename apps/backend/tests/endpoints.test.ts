// Auth endpoint edges: start / callback plumbing (state CSRF, rate
// limits, next sanitization) against the sole registered provider
// (workos), plus sign-out. The workos happy paths + identity linking
// live in workos.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { onRequestGet as callbackGet } from '../functions/api/auth/[provider]/callback'
import { onRequestGet as startGet } from '../functions/api/auth/[provider]/start'
import { onRequestPost as signOutPost } from '../functions/api/auth/sign-out'

import { getSetCookies, invoke } from './_helpers/ctx'
import { makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

function envFor(dbState?: FakeDbState) {
  const { db, state } = makeDb(dbState)
  return {
    DB: db,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    WORKOS_CLIENT_ID: 'client_test',
    WORKOS_API_KEY: 'sk_test',
    state,
  }
}

function workosOk(url: string): Response | null {
  if (url.endsWith('/user_management/authenticate')) {
    return new Response(
      JSON.stringify({
        user: { id: 'user_w1', email: 'w@example.com', first_name: 'W', last_name: null },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  if (url.includes('/user_management/users/')) {
    return new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return null
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/auth/workos/callback — plumbing edges', () => {
  it('400 when code or state query params are missing', async () => {
    const env = envFor()
    const req = new Request('https://spool.pro/api/auth/workos/callback?code=abc')
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(400)
  })

  it('400 when state cookie is absent', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/workos/callback?code=abc&state=xyz',
    )
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(400)
  })

  it('403 when state cookie does not match query state', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/workos/callback?code=abc&state=fromUrl',
      {
        headers: {
          cookie: '__spool_oauth_state=otherState|/; __spool_oauth_verifier=v',
        },
      },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
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
      'https://spool.pro/api/auth/workos/callback?code=abc&state=xyz',
      { headers: { 'CF-Connecting-IP': '8.8.8.8' } },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(429)
  })

  it('403 when the code exchange fails upstream', async () => {
    const env = envFor()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    )
    const req = new Request(
      'https://spool.pro/api/auth/workos/callback?code=bad&state=S',
      {
        headers: { cookie: '__spool_oauth_state=S|/me; __spool_oauth_verifier=v' },
      },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(403)
    expect(env.state.users).toHaveLength(0)
  })

  it('ASCII-encodes a non-ASCII next so the Location header is RFC-compliant', async () => {
    // Browser autocomplete / IME quirks can inject UTF-8 into the next
    // query param. safeNext only enforces open-redirect rules, so the
    // cookie carries the raw bytes through to here. The Location header
    // must be ASCII — encodeURI keeps `/?&=` intact and percent-encodes
    // the rest.
    const env = envFor()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const res = workosOk(String(input))
      if (!res) throw new Error(`unexpected fetch: ${String(input)}`)
      return res
    })
    const req = new Request(
      'https://spool.pro/api/auth/workos/callback?code=c&state=S',
      {
        headers: {
          cookie:
            '__spool_oauth_state=S|/me%E3%80%82%E8%BF%99%E6%AC%A1; __spool_oauth_verifier=v',
        },
      },
    )
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toBe('/me%E3%80%82%E8%BF%99%E6%AC%A1')
    // Pure ASCII — no raw UTF-8 bytes left.
    expect(loc).toMatch(/^[\x00-\x7f]*$/)
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
  it('redirects to AuthKit and sets both oauth cookies', async () => {
    const env = envFor()
    const req = new Request('https://spool.pro/api/auth/workos/start?next=/me')
    const res = await invoke(startGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(302)
    const loc = res.headers.get('location') ?? ''
    expect(loc).toMatch(/^https:\/\/api\.workos\.com\/user_management\/authorize\?/)
    expect(loc).toMatch(/provider=authkit/)
    const joined = getSetCookies(res).join('\n')
    expect(joined).toMatch(/__spool_oauth_state=/)
    expect(joined).toMatch(/__spool_oauth_verifier=/)
  })

  it('coerces an unsafe next param back to /', async () => {
    const env = envFor()
    const req = new Request(
      'https://spool.pro/api/auth/workos/start?next=//evil.example.com',
    )
    const res = await invoke(startGet, req, env, { provider: 'workos' })
    const stateCookie =
      getSetCookies(res).find((c) => c.includes('__spool_oauth_state=')) ?? ''
    // The cookie value is `${state}|${next}`. Ensure the next half is `/`.
    expect(stateCookie).toMatch(/__spool_oauth_state=[^|]+\|\/;/)
  })

  it('404s on an unknown provider (no scanner enumeration)', async () => {
    const env = envFor()
    for (const provider of ['github', 'google']) {
      const req = new Request(`https://spool.pro/api/auth/${provider}/start`)
      const res = await invoke(startGet, req, env, { provider })
      expect(res.status).toBe(404)
    }
  })

  it('callback 404s on an unknown provider', async () => {
    const env = envFor()
    for (const provider of ['github', 'google']) {
      const req = new Request(
        `https://spool.pro/api/auth/${provider}/callback?code=x&state=y`,
      )
      const res = await invoke(callbackGet, req, env, { provider })
      expect(res.status).toBe(404)
    }
  })
})

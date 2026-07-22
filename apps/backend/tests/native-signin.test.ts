// Desktop PKCE sign-in endpoint (/api/auth/sign-in-with-code): redeems
// the app's authorization code via the provider's public-client
// exchange, links legacy accounts, mints a KV session.

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  SIGNIN_RATE_MAX,
  SIGNIN_RATE_WINDOW_SEC,
  onRequestPost as signInPost,
} from '../functions/api/auth/sign-in-with-code'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

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

function request(body: unknown): Request {
  return new Request('https://spool.new/api/auth/sign-in-with-code', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockWorkos(opts: { identities?: unknown } = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url.endsWith('/user_management/authenticate')) {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>
      // Public-client exchange: verifier present, secret absent.
      expect(body['code_verifier']).toBeTruthy()
      expect(body['client_secret']).toBeUndefined()
      return new Response(
        JSON.stringify({
          user: { id: 'user_w9', email: 'n@example.com', first_name: 'Nat', last_name: null },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('/user_management/users/')) {
      return new Response(JSON.stringify(opts.identities ?? []), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/user_management/organization_memberships?')) {
      return new Response(JSON.stringify({ data: [], list_metadata: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`unexpected fetch: ${url}`)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/auth/sign-in-with-code', () => {
  it('200 + session token + user for a fresh sign-in', async () => {
    const env = envFor()
    mockWorkos()
    const res = await invoke(
      signInPost,
      request({ provider: 'workos', code: 'authcode', code_verifier: 'verifier' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      session_token: string
      exp: number
      user: { id: string; email: string }
    }
    expect(body.session_token.length).toBeGreaterThanOrEqual(43)
    expect(body.user.email).toBe('n@example.com')
    // Session actually lives in KV.
    expect(await env.SESSIONS.get(`session/${body.session_token}`)).toBeTruthy()
    expect(env.state.audit).toEqual([
      expect.objectContaining({
        action: 'signin.desktop',
        details_json: JSON.stringify({ provider: 'workos' }),
      }),
    ])
  })

  it('links onto a legacy google account instead of forking', async () => {
    const state = emptyState()
    state.users.push({
      id: 'legacy1',
      email: 'old@example.com',
      name: 'Old',
      avatar_url: null,
      created_at: 1,
      last_signin_at: 1,
      deletion_pending_until: null,
      deleted_at: null,
    })
    state.user_identities.push({
      provider: 'google',
      provider_sub: 'g-9',
      user_id: 'legacy1',
      email: 'old@example.com',
      linked_at: 1,
    })
    const env = envFor(state)
    mockWorkos({ identities: [{ idp_id: 'g-9', provider: 'GoogleOAuth' }] })
    const res = await invoke(
      signInPost,
      request({ provider: 'workos', code: 'c', code_verifier: 'v' }),
      env,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    expect(body.user.id).toBe('legacy1')
    expect(env.state.users).toHaveLength(1)
    expect(env.state.user_identities).toHaveLength(2)
  })

  it('400 on missing fields and unknown provider', async () => {
    const env = envFor()
    for (const body of [
      {},
      { provider: 'workos', code: 'c' },
      { provider: 'workos', code: '', code_verifier: 'v' },
      { provider: 'github', code: 'c', code_verifier: 'v' },
      { provider: 'google', code: 'c', code_verifier: 'v' },
    ]) {
      const res = await invoke(signInPost, request(body), env)
      expect(res.status).toBe(400)
    }
    expect(env.state.users).toHaveLength(0)
  })

  it('403 when the provider rejects the code', async () => {
    const env = envFor()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"error":"invalid_grant"}', { status: 400 }),
    )
    const res = await invoke(
      signInPost,
      request({ provider: 'workos', code: 'bad', code_verifier: 'v' }),
      env,
    )
    expect(res.status).toBe(403)
    expect(env.state.users).toHaveLength(0)
  })

  it('429 when the per-IP signin window is exhausted', async () => {
    const env = envFor()
    const slot = Math.floor(Date.now() / 1000 / SIGNIN_RATE_WINDOW_SEC)
    await env.RATE.put(`rate/signin/9.9.9.9/${slot}`, String(SIGNIN_RATE_MAX), {
      expirationTtl: SIGNIN_RATE_WINDOW_SEC * 2,
    })
    const req = new Request('https://spool.new/api/auth/sign-in-with-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '9.9.9.9' },
      body: JSON.stringify({ provider: 'workos', code: 'c', code_verifier: 'v' }),
    })
    const res = await invoke(signInPost, req, env)
    expect(res.status).toBe(429)
  })
})

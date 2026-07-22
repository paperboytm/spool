// WorkOS provider + legacy-identity linking. Unit-level provider tests
// stub fetch per-call; the callback tests run the real handler against
// the in-memory fakes (plumbing edges live in endpoints.test.ts).

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { onRequestGet as callbackGet } from '../functions/api/auth/[provider]/callback'
import { onRequestGet as startGet } from '../functions/api/auth/[provider]/start'
import { workosProvider } from '../src/auth/providers/workos'
import { upsertUserByIdentity } from '../src/store/d1'
import { getSetCookies, invoke } from './_helpers/ctx'
import { makeDb, makeKv, emptyState, type FakeDbState } from './_helpers/fakes'

const ENV = { WORKOS_CLIENT_ID: 'client_123', WORKOS_API_KEY: 'sk_test_abc' }

function workosUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_wos_1',
    email: 'w@example.com',
    first_name: 'Wo',
    last_name: 'Kos',
    profile_picture_url: 'https://cdn.example.com/p.png',
    email_verified: true,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workosProvider.buildAuthRequestUrl', () => {
  it('points at the hosted AuthKit authorize endpoint', () => {
    const url = new URL(
      workosProvider.buildAuthRequestUrl(
        {
          state: 'S1',
          codeChallenge: 'unused-challenge',
          redirectUri: 'https://spool.new/api/auth/workos/callback',
        },
        ENV,
      ),
    )
    expect(url.origin + url.pathname).toBe('https://api.workos.com/user_management/authorize')
    expect(url.searchParams.get('client_id')).toBe('client_123')
    expect(url.searchParams.get('provider')).toBe('authkit')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('S1')
    expect(url.searchParams.get('redirect_uri')).toBe('https://spool.new/api/auth/workos/callback')
    // Confidential client: the PKCE challenge from /start must NOT be
    // forwarded — WorkOS rejects mixing code_challenge with client_secret.
    expect(url.searchParams.get('code_challenge')).toBeNull()
  })

  it('throws INTERNAL without a client id', () => {
    expect(() =>
      workosProvider.buildAuthRequestUrl(
        { state: 's', codeChallenge: 'c', redirectUri: 'https://x/cb' },
        {},
      ),
    ).toThrow(/WORKOS_CLIENT_ID/)
  })
})

describe('workosProvider.exchangeCode', () => {
  it('maps the authenticate response onto an IdentityClaim', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ user: workosUser() }))
    const claim = await workosProvider.exchangeCode(
      { code: 'authcode', codeVerifier: 'ignored', redirectUri: 'https://x/cb' },
      ENV,
    )
    expect(claim).toEqual({
      provider: 'workos',
      sub: 'user_wos_1',
      email: 'w@example.com',
      name: 'Wo Kos',
      avatar_url: 'https://cdn.example.com/p.png',
    })
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://api.workos.com/user_management/authenticate')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toEqual({
      grant_type: 'authorization_code',
      client_id: 'client_123',
      client_secret: 'sk_test_abc',
      code: 'authcode',
    })
  })

  it('null name when WorkOS has no first/last name', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ user: workosUser({ first_name: null, last_name: null }) }),
    )
    const claim = await workosProvider.exchangeCode(
      { code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' },
      ENV,
    )
    expect(claim.name).toBeNull()
  })

  it('FORBIDDEN on a non-2xx exchange', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400))
    await expect(
      workosProvider.exchangeCode(
        { code: 'bad', codeVerifier: 'v', redirectUri: 'https://x/cb' },
        ENV,
      ),
    ).rejects.toThrow(/token exchange/)
  })

  it('honors the DEV_WORKOS_API_URL reroute', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ user: workosUser() }))
    await workosProvider.exchangeCode(
      { code: 'c', codeVerifier: 'v', redirectUri: 'https://x/cb' },
      { ...ENV, DEV_WORKOS_API_URL: 'http://127.0.0.1:9999' },
    )
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(
      'http://127.0.0.1:9999/user_management/authenticate',
    )
  })
})

describe('workosProvider.resolveAliasIdentities', () => {
  it('maps GoogleOAuth identities and skips the rest', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse([
        { idp_id: 'g-sub-9', provider: 'GoogleOAuth', type: 'OAuth' },
        { idp_id: 'gh-77', provider: 'GithubOAuth', type: 'OAuth' },
        { provider: 'GoogleOAuth' }, // no idp_id → skipped
      ]),
    )
    const refs = await workosProvider.resolveAliasIdentities!('user_wos_1', ENV)
    expect(refs).toEqual([{ provider: 'google', sub: 'g-sub-9' }])
    const [url, init] = fetchSpy.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://api.workos.com/user_management/users/user_wos_1/identities')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk_test_abc')
  })

  it('propagates failure instead of failing open', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, 500))
    await expect(workosProvider.resolveAliasIdentities!('user_wos_1', ENV)).rejects.toThrow(
      /identities/,
    )
  })
})

describe('upsertUserByIdentity alias linking', () => {
  const workosClaim = {
    provider: 'workos' as const,
    sub: 'user_wos_1',
    email: 'w@example.com',
    name: 'Wo Kos',
    avatar_url: null,
  }

  function stateWithGoogleUser(): FakeDbState {
    const state = emptyState()
    state.users.push({
      id: 'legacy1',
      email: 'old@example.com',
      name: 'Old Name',
      avatar_url: null,
      created_at: 1,
      last_signin_at: 1,
      deletion_pending_until: null,
      deleted_at: null,
    })
    state.user_identities.push({
      provider: 'google',
      provider_sub: 'g-sub-9',
      user_id: 'legacy1',
      email: 'old@example.com',
      linked_at: 1,
    })
    return state
  }

  it('links onto the legacy google user instead of creating a duplicate', async () => {
    const { db, state } = makeDb(stateWithGoogleUser())
    const user = await upsertUserByIdentity(db, workosClaim, {
      resolveAliases: async () => [{ provider: 'google', sub: 'g-sub-9' }],
    })
    expect(user.id).toBe('legacy1')
    expect(user.email).toBe('w@example.com')
    expect(state.users).toHaveLength(1)
    expect(state.user_identities).toHaveLength(2)
    expect(state.user_identities[1]).toMatchObject({
      provider: 'workos',
      provider_sub: 'user_wos_1',
      user_id: 'legacy1',
    })
  })

  it('second sign-in hits the workos identity directly — no alias call', async () => {
    const { db } = makeDb(stateWithGoogleUser())
    await upsertUserByIdentity(db, workosClaim, {
      resolveAliases: async () => [{ provider: 'google', sub: 'g-sub-9' }],
    })
    const resolveAliases = vi.fn()
    const again = await upsertUserByIdentity(db, workosClaim, { resolveAliases })
    expect(again.id).toBe('legacy1')
    expect(resolveAliases).not.toHaveBeenCalled()
  })

  it('creates a fresh user when no alias matches', async () => {
    const { db, state } = makeDb(stateWithGoogleUser())
    const user = await upsertUserByIdentity(db, workosClaim, {
      resolveAliases: async () => [{ provider: 'google', sub: 'other-sub' }],
    })
    expect(user.id).not.toBe('legacy1')
    expect(state.users).toHaveLength(2)
  })

  it('propagates resolveAliases failure (no silent account fork)', async () => {
    const { db, state } = makeDb(stateWithGoogleUser())
    await expect(
      upsertUserByIdentity(db, workosClaim, {
        resolveAliases: async () => {
          throw new Error('workos identities fetch')
        },
      }),
    ).rejects.toThrow(/identities/)
    expect(state.users).toHaveLength(1)
  })

  it('FORBIDDEN when the aliased account is deleted', async () => {
    const state = stateWithGoogleUser()
    state.users[0]!.deleted_at = 123
    const { db } = makeDb(state)
    await expect(
      upsertUserByIdentity(db, workosClaim, {
        resolveAliases: async () => [{ provider: 'google', sub: 'g-sub-9' }],
      }),
    ).rejects.toThrow(/account deleted/)
  })
})

describe('workos web flow endpoints', () => {
  function envFor(dbState?: FakeDbState) {
    const { db, state } = makeDb(dbState)
    return {
      DB: db,
      SESSIONS: makeKv(),
      RATE: makeKv(),
      ...ENV,
      state,
    }
  }

  it('returns a structured error instead of throwing when WorkOS is not configured', async () => {
    const req = new Request('https://spool.new/api/auth/workos/start?next=/me')
    const res = await invoke(
      startGet,
      req,
      { PUBLIC_BASE_URL: 'https://spool.new' },
      { provider: 'workos' },
    )

    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('application/json')
    await expect(res.json()).resolves.toEqual({
      error: 'INTERNAL',
      detail: 'no WORKOS_CLIENT_ID',
    })
  })

  it('start 302s to AuthKit with state + next baked into cookies', async () => {
    const env = envFor()
    const req = new Request('https://spool.new/api/auth/workos/start?next=/me')
    const res = await invoke(startGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location') ?? '')
    expect(loc.origin + loc.pathname).toBe('https://api.workos.com/user_management/authorize')
    expect(loc.searchParams.get('provider')).toBe('authkit')
    const cookies = getSetCookies(res).join('\n')
    expect(cookies).toMatch(/__spool_oauth_state=/)
  })

  it('callback exchanges the code, links the legacy user, sets the session cookie', async () => {
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
      provider_sub: 'g-sub-9',
      user_id: 'legacy1',
      email: 'old@example.com',
      linked_at: 1,
    })
    const env = envFor(state)
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/user_management/authenticate')) {
        return jsonResponse({ user: workosUser() })
      }
      if (url.endsWith('/user_management/users/user_wos_1/identities')) {
        return jsonResponse([{ idp_id: 'g-sub-9', provider: 'GoogleOAuth' }])
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const req = new Request('https://spool.new/api/auth/workos/callback?code=goodcode&state=S', {
      headers: {
        cookie: '__spool_oauth_state=S|/me; __spool_oauth_verifier=v',
      },
    })
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/me')
    expect(getSetCookies(res).join('\n')).toMatch(/spool_session=/)
    // Linked, not forked.
    expect(env.state.users).toHaveLength(1)
    expect(env.state.user_identities).toHaveLength(2)
    expect(env.state.audit).toEqual([
      expect.objectContaining({
        user_id: 'legacy1',
        action: 'signin.web',
        details_json: JSON.stringify({ provider: 'workos' }),
      }),
    ])
  })

  it('callback fails closed when the identities lookup errors', async () => {
    const env = envFor()
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/user_management/authenticate')) {
        return jsonResponse({ user: workosUser() })
      }
      return jsonResponse({}, 500)
    })
    const req = new Request('https://spool.new/api/auth/workos/callback?code=c&state=S', {
      headers: {
        cookie: '__spool_oauth_state=S|/me; __spool_oauth_verifier=v',
      },
    })
    const res = await invoke(callbackGet, req, env, { provider: 'workos' })
    expect(res.status).toBe(500)
    expect(env.state.users).toHaveLength(0)
  })
})

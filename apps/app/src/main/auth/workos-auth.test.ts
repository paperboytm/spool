import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dispatchDeepLink } from './deep-link.js'

const opened: string[] = []

// Simulate the user completing AuthKit sign-in: the browser redirects
// to spool://auth/callback, which the OS hands to the deep-link
// dispatcher. Deferred a tick so the flow is already awaiting the
// callback (mirrors reality; also exercises subscribe-before-open
// ordering). Hoisted function declaration so both the vi.mock factory
// and the beforeEach reset below can reference it.
async function approveInBrowser(url: string): Promise<void> {
  opened.push(url)
  const state = new URL(url).searchParams.get('state')!
  queueMicrotask(() => {
    dispatchDeepLink(`spool://auth/callback?code=AUTHCODE&state=${state}`)
  })
}

vi.mock('electron', () => ({
  app: {
    // deep-link.ts touches app only inside registerDeepLinkScheme(),
    // which these tests never call — the stub keeps the import happy.
    setAsDefaultProtocolClient: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(approveInBrowser),
  },
  // workos-auth.ts routes its backend POST through robustFetch, whose
  // first transport is net.fetch (system-proxy support). Forward to
  // globalThis.fetch so the per-test spies below keep intercepting; the
  // fallback transports (which would touch `session`) never engage.
  net: {
    fetch: (url: string, init?: RequestInit) => globalThis.fetch(url, init),
  },
  session: {
    fromPartition: () => {
      throw new Error('fallback transport engaged unexpectedly in tests')
    },
  },
}))

describe('signInWithWorkos (PKCE + spool:// callback orchestrator)', () => {
  beforeEach(async () => {
    opened.length = 0
    process.env['SPOOL_WORKOS_CLIENT_ID'] = 'client_test_123'
    process.env['SPOOL_SHARE_BACKEND'] = 'https://example.test'
    // Per-test mockImplementation overrides survive restoreAllMocks on
    // factory-created vi.fn()s — pin the default back explicitly.
    const { shell } = await import('electron')
    vi.mocked(shell.openExternal).mockImplementation(approveInBrowser)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['SPOOL_WORKOS_CLIENT_ID']
    delete process.env['SPOOL_SHARE_BACKEND']
  })

  it('throws if the WorkOS client id env var is missing', async () => {
    delete process.env['SPOOL_WORKOS_CLIENT_ID']
    const { signInWithWorkos } = await import('./workos-auth.js')
    await expect(signInWithWorkos()).rejects.toThrow(/SPOOL_WORKOS_CLIENT_ID missing/)
  })

  it('full happy path: opens AuthKit with PKCE, posts code+verifier to backend', async () => {
    let capturedBody: Record<string, string> | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      // fetchOnce probes the target origin with a GET before the real
      // request; any HTTP response (status irrelevant) selects the transport.
      if (url === 'https://example.test/') {
        return new Response('probe', { status: 404 })
      }
      if (url.startsWith('https://example.test/api/auth/sign-in-with-code')) {
        capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>
        return new Response(
          JSON.stringify({
            session_token: 'sess_123',
            user: { id: 'u1', email: 'a@b.c', name: 'Anne', avatar_url: null, handle: null },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const { signInWithWorkos } = await import('./workos-auth.js')
    const result = await signInWithWorkos()

    expect(opened).toHaveLength(1)
    const auth = new URL(opened[0]!)
    expect(auth.origin + auth.pathname).toBe(
      'https://api.workos.com/user_management/authorize',
    )
    expect(auth.searchParams.get('client_id')).toBe('client_test_123')
    expect(auth.searchParams.get('provider')).toBe('authkit')
    expect(auth.searchParams.get('response_type')).toBe('code')
    expect(auth.searchParams.get('redirect_uri')).toBe('spool://auth/callback')
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(auth.searchParams.get('code_challenge')).toBeTruthy()

    expect(capturedBody).toMatchObject({ provider: 'workos', code: 'AUTHCODE' })
    expect(capturedBody!['code_verifier']).toBeTruthy()
    expect(result).toEqual({
      session_token: 'sess_123',
      user: { id: 'u1', email: 'a@b.c', name: 'Anne', avatar_url: null, handle: null },
    })
  })

  it('ignores callbacks with a stale state and rejects on AuthKit error params', async () => {
    const { shell } = await import('electron')
    vi.mocked(shell.openExternal).mockImplementation(async (url: string) => {
      opened.push(url)
      const state = new URL(url).searchParams.get('state')!
      queueMicrotask(() => {
        // Stale callback from an abandoned attempt — must be ignored.
        dispatchDeepLink('spool://auth/callback?code=STALE&state=not-ours')
        // The real callback carries an explicit provider error.
        dispatchDeepLink(
          `spool://auth/callback?error=access_denied&error_description=User+cancelled&state=${state}`,
        )
      })
    })

    const { signInWithWorkos } = await import('./workos-auth.js')
    await expect(signInWithWorkos()).rejects.toThrow(/User cancelled/)
  })

  it('surfaces backend rejection with status and body excerpt', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url === 'https://example.test/') return new Response('probe', { status: 404 })
      return new Response('{"error":"FORBIDDEN","detail":"token exchange"}', { status: 403 })
    })
    const { signInWithWorkos } = await import('./workos-auth.js')
    await expect(signInWithWorkos()).rejects.toThrow(/backend sign-in 403/)
  })
})

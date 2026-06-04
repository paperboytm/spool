import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Save the real fetch before any mocking so the loopback HTTP server (which
// runs on 127.0.0.1 inside the same process) can be reached.
const realFetch = globalThis.fetch.bind(globalThis)

const opened: string[] = []

vi.mock('electron', () => ({
  shell: {
    openExternal: vi.fn(async (url: string) => {
      opened.push(url)
      // Simulate the user completing Google sign-in: hit the loopback /callback
      // with the same state from the auth URL, using the REAL fetch.
      const u = new URL(url)
      const redirectUri = u.searchParams.get('redirect_uri')!
      const state = u.searchParams.get('state')!
      const cb = new URL(redirectUri)
      cb.searchParams.set('code', 'AUTHCODE')
      cb.searchParams.set('state', state)
      void realFetch(cb.toString()).catch(() => undefined)
    }),
  },
}))

describe('signInWith (loopback OAuth orchestrator)', () => {
  beforeEach(() => {
    opened.length = 0
    process.env['SPOOL_GOOGLE_CLIENT_ID_DESKTOP'] = 'test-client.apps.googleusercontent.com'
    process.env['SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP'] = 'GOCSPX-test-secret'
    process.env['SPOOL_SHARE_BACKEND'] = 'https://example.test'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env['SPOOL_GOOGLE_CLIENT_ID_DESKTOP']
    delete process.env['SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP']
    delete process.env['SPOOL_SHARE_BACKEND']
  })

  it('throws if the provider client id env var is missing', async () => {
    delete process.env['SPOOL_GOOGLE_CLIENT_ID_DESKTOP']
    const { signInWith } = await import('./oauth.js')
    await expect(signInWith('google')).rejects.toThrow(
      /SPOOL_GOOGLE_CLIENT_ID_DESKTOP missing/,
    )
  })

  it('throws if Google client secret env var is missing', async () => {
    // Google's installed-app token exchange requires client_secret even
    // with PKCE — fail early with a clear "missing env" error instead
    // of letting Google return an opaque 400.
    delete process.env['SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP']
    const { signInWith } = await import('./oauth.js')
    await expect(signInWith('google')).rejects.toThrow(
      /SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP missing/,
    )
  })

  it('full happy path: opens browser, exchanges code with PKCE, posts to backend with provider', async () => {
    let capturedNonce: string | null = null
    let capturedProvider: string | null = null
    let capturedVerifier: string | null = null

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url.startsWith('http://127.0.0.1')) {
        // Loopback: delegate to the real fetch (mock should be transparent here).
        return realFetch(input as Parameters<typeof realFetch>[0], init)
      }
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        const body = init?.body as URLSearchParams
        capturedVerifier = body.get('code_verifier')
        expect(body.get('code')).toBe('AUTHCODE')
        expect(body.get('grant_type')).toBe('authorization_code')
        expect(body.get('client_id')).toBe('test-client.apps.googleusercontent.com')
        // Google's installed-app flow requires client_secret in the
        // token exchange — present it even though it isn't truly
        // secret per Google's own docs.
        expect(body.get('client_secret')).toBe('GOCSPX-test-secret')
        return new Response(JSON.stringify({ id_token: 'ID.TOKEN.XYZ' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      if (url.startsWith('https://example.test/api/auth/sign-in-with-id-token')) {
        const body = JSON.parse(String(init?.body ?? '{}'))
        expect(body.id_token).toBe('ID.TOKEN.XYZ')
        capturedNonce = body.nonce
        capturedProvider = body.provider
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

    const { signInWith } = await import('./oauth.js')
    const result = await signInWith('google')

    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('accounts.google.com/o/oauth2/v2/auth')
    expect(opened[0]).toContain('code_challenge_method=S256')
    expect(capturedVerifier).toBeTruthy()
    expect(capturedNonce).toBeTruthy()
    expect(capturedProvider).toBe('google')
    expect(result).toEqual({
      session_token: 'sess_123',
      user: { id: 'u1', email: 'a@b.c', name: 'Anne', avatar_url: null, handle: null },
    })
  })

  it('rejects an unregistered provider', async () => {
    const { signInWith } = await import('./oauth.js')
    // @ts-expect-error — runtime guard, not type-level — proves callers
    // who lose the type discipline still hit a clear error instead of a
    // misleading "client id missing" downstream.
    await expect(signInWith('github')).rejects.toThrow(/unknown provider/)
  })
})

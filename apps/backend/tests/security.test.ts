import type { KVNamespace } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vite-plus/test'

import { safeNext } from '../src/auth/next'
import type { SessionRecord } from '../src/auth/session'
import { nanoidSlug } from '../src/publish/slug'
import { API_CSP } from '../src/security/csp'
import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

// Mock workers-og so importing publish.ts doesn't pull in Satori/wasm.
vi.mock('workers-og', () => ({
  ImageResponse: vi.fn().mockImplementation(() => ({
    async arrayBuffer() {
      return new Uint8Array([137, 80, 78, 71]).buffer
    },
  })),
}))

const TOKEN = 't'.repeat(40)

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  const snapshots = makeR2()
  const og = makeR2()
  return {
    DB: db,
    SESSIONS: makeKv(),
    META: makeKv(),
    RATE: makeKv(),
    NONCE: makeKv(),
    SNAPSHOTS: snapshots.bucket,
    OG: og.bucket,
    WORKOS_CLIENT_ID: 'client_test',
    WORKOS_API_KEY: 'sk_test',
    state: s,
    _snapshots: snapshots.store,
    _og: og.store,
  }
}

function seedUser(state: FakeDbState, id = 'user-1'): void {
  state.users.push({
    id,
    email: `${id}@example.com`,
    name: id,
    avatar_url: null,
    created_at: Date.now(),
    last_signin_at: Date.now(),
    deletion_pending_until: null,
    deleted_at: null,
  })
}

async function seedSession(kv: KVNamespace, token: string, user_id: string): Promise<void> {
  const now = Date.now()
  const rec: SessionRecord = {
    user_id,
    created: now,
    exp: now + 30 * 24 * 3600 * 1000,
    last_seen: now,
  }
  await kv.put(`session/${token}`, JSON.stringify(rec), { expirationTtl: 30 * 24 * 3600 })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(
  req: Request,
  env: Record<string, unknown>,
  params: Record<string, string> = {},
): any {
  return {
    request: req,
    env,
    next: async () => new Response('not-found', { status: 404 }),
    params,
    waitUntil: (p: Promise<unknown>) => {
      void p
    },
    passThroughOnException: () => undefined,
    data: {},
  }
}

function authedReq(url: string, body?: unknown, method: string = 'POST', token = TOKEN): Request {
  const init: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'CF-Connecting-IP': '1.2.3.4',
    },
  }
  let payload = body
  if (
    url.endsWith('/api/publish') &&
    body &&
    typeof body === 'object' &&
    'snapshot' in (body as Record<string, unknown>)
  ) {
    const obj = body as Record<string, unknown>
    payload = {
      draft_id: 'test-draft-id',
      idempotency_key: 'key-' + Math.random().toString(36).slice(2, 10).padEnd(8, 'x'),
      ...obj,
    }
  }
  if (payload !== undefined) init.body = JSON.stringify(payload)
  return new Request(url, init)
}

function makeSnapshot() {
  return {
    schema_version: 1,
    source: { kind: 'spool-session', captured_at: new Date().toISOString() },
    conversation: {
      title: 'A nice chat',
      turns: [
        { id: 't1', role: 'user', content: 'Hello there.' },
        { id: 't2', role: 'assistant', content: 'Hi!' },
      ],
      turn_order: ['t1', 't2'],
      hidden_turns: [],
    },
    edits: [],
    redactions: [],
    editor_opts: {
      template: 'forum',
      paper: 'cream',
      typeface: 'geist',
      colorway: 'amber',
      density: 'relaxed',
      masthead: true,
      colophon: true,
      avatars: true,
      show_byline: true,
    },
  }
}

// ────────────────────────────────────────────────────────────────────
// Middleware: CSP + cache-control defaults for /api/*
// ────────────────────────────────────────────────────────────────────

describe('_middleware security headers', () => {
  it('sets API_CSP on /api/* responses', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const req = new Request('https://x/api/me', { method: 'GET' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('content-security-policy')).toBe(API_CSP)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('adds Cache-Control: no-store to mutation API responses with no explicit header', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const req = new Request('https://x/api/publish', { method: 'POST' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('does NOT override an explicit Referrer-Policy from a handler', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response(null, {
      status: 302,
      headers: {
        location: 'https://x/api/auth/workos/start',
        'referrer-policy': 'no-referrer',
      },
    })
    const req = new Request('https://x/api/auth/workos/callback?code=secret', { method: 'GET' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('does NOT override an explicit Cache-Control on a mutation', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('{"ok":true}', {
      headers: { 'cache-control': 'private, max-age=5' },
    })
    const req = new Request('https://x/api/something', { method: 'POST' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('cache-control')).toBe('private, max-age=5')
  })

  it('does NOT override an explicit Cache-Control on a GET (handler keeps its public/max-age)', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('{"ok":true}', {
      headers: { 'cache-control': 'public, max-age=60' },
    })
    const req = new Request('https://x/api/snapshots/abc', { method: 'GET' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
  })

  it('adds Cache-Control: no-store to GET API responses with no explicit header', async () => {
    // Defense-in-depth: any future /api/* GET that forgets to set
    // Cache-Control (think /api/me, /api/admin/audit, /api/me/shares)
    // must still 'no-store' by default — otherwise a shared cache
    // could fan out one user's private response to other readers.
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
    const req = new Request('https://x/api/me', { method: 'GET' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('marks tenant API success and error responses private and credential-varying', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const cases = [
      { url: 'https://x/api/teams', method: 'GET', status: 200 },
      { url: 'https://x/api/teams/team_1/members', method: 'POST', status: 403 },
      { url: 'https://x/api/me/sessions', method: 'GET', status: 200 },
      { url: 'https://x/api/me/sessions/codex_1', method: 'PATCH', status: 404 },
    ]

    for (const testCase of cases) {
      const req = new Request(testCase.url, { method: testCase.method })
      const inner = new Response('{"ok":true}', {
        status: testCase.status,
        headers: { vary: 'Accept-Encoding' },
      })
      const res = await (
        onRequest as unknown as (c: {
          request: Request
          next: () => Promise<Response>
        }) => Promise<Response>
      )({ request: req, next: async () => inner })

      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(res.headers.get('vary')).toBe('Accept-Encoding, Cookie, Authorization')
    }
  })

  it('does NOT set CSP for non-/api routes', async () => {
    const { onRequest } = await import('../functions/_middleware')
    const inner = new Response('<html/>', { headers: { 'content-type': 'text/html' } })
    const req = new Request('https://x/some-page', { method: 'GET' })
    const res = await (
      onRequest as unknown as (c: {
        request: Request
        next: () => Promise<Response>
      }) => Promise<Response>
    )({ request: req, next: async () => inner })
    expect(res.headers.get('content-security-policy')).toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────
// Authn: unauthed endpoints
// ────────────────────────────────────────────────────────────────────

describe('unauthenticated requests', () => {
  it('/api/publish without bearer → 401, no payload leak', async () => {
    const { onRequestPost } = await import('../functions/api/publish')
    const env = envFor()
    const req = new Request('https://x/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: makeSnapshot(), visibility: 'unlisted' }),
    })
    const res = await onRequestPost(ctxFor(req, env))
    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string; detail?: string }
    expect(body.error).toBe('UNAUTHENTICATED')
    // No snapshot data echoed.
    const text = JSON.stringify(body)
    expect(text).not.toMatch(/A nice chat/)
    expect(text).not.toMatch(/Hello there/)
  })

  it('/api/revoke/<id> without bearer → 401', async () => {
    const { onRequestPost } = await import('../functions/api/revoke/[id]')
    const env = envFor()
    const id = nanoidSlug()
    const req = new Request(`https://x/api/revoke/${id}`, { method: 'POST' })
    const res = await onRequestPost(ctxFor(req, env, { id }))
    expect(res.status).toBe(401)
  })
})

// ────────────────────────────────────────────────────────────────────
// Authz: cross-user does not leak existence
// ────────────────────────────────────────────────────────────────────

describe('authorization isolation', () => {
  it('revoke someone else’s slug → 404 (no existence leak)', async () => {
    const { onRequestPost } = await import('../functions/api/revoke/[id]')
    const env = envFor()
    seedUser(env.state, 'me')
    seedUser(env.state, 'them')
    await seedSession(env.SESSIONS, TOKEN, 'me')
    const theirs = nanoidSlug()
    env.state.published_shares.push({
      id: theirs,
      user_id: 'them',
      title: 't',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: Date.now(),
      republished_at: null,
      revoked_at: null,
    })
    const req = authedReq(`https://x/api/revoke/${theirs}`, undefined, 'POST')
    const res = await onRequestPost(ctxFor(req, env, { id: theirs }))
    expect(res.status).toBe(404)
  })

  it('republish someone else’s slug → 404', async () => {
    const { onRequestPost } = await import('../functions/api/publish')
    const env = envFor()
    seedUser(env.state, 'me')
    seedUser(env.state, 'them')
    await seedSession(env.SESSIONS, TOKEN, 'me')
    const theirs = nanoidSlug()
    env.state.published_shares.push({
      id: theirs,
      user_id: 'them',
      title: 't',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: Date.now(),
      republished_at: null,
      revoked_at: null,
    })
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
      override_slug: theirs,
    })
    const res = await onRequestPost(ctxFor(req, env))
    expect(res.status).toBe(404)
  })
})

// ────────────────────────────────────────────────────────────────────
// safeNext: open-redirect defense
// ────────────────────────────────────────────────────────────────────

describe('safeNext', () => {
  it('rejects absolute external URLs', () => {
    expect(safeNext('https://evil.com')).toBe('/')
    expect(safeNext('http://evil.com')).toBe('/')
  })
  it('rejects protocol-relative URLs', () => {
    expect(safeNext('//evil.com')).toBe('/')
    expect(safeNext('//evil.com/foo')).toBe('/')
  })
  it('rejects backslash injection', () => {
    expect(safeNext('/\\evil.com')).toBe('/')
  })
  it('rejects percent-encoded protocol-relative bypass', () => {
    // /%2Fevil.com decodes to //evil.com — must be rejected even
    // though raw.startsWith('//') is false at first glance.
    expect(safeNext('/%2Fevil.com')).toBe('/')
    expect(safeNext('/%2f%2fevil.com')).toBe('/')
    expect(safeNext('/%2F%2Fevil.com/foo')).toBe('/')
  })
  it('rejects percent-encoded backslash and traversal', () => {
    expect(safeNext('/%5Cevil.com')).toBe('/')
    expect(safeNext('/foo/%2E%2E/bar')).toBe('/')
  })
  it('rejects malformed percent-encoding', () => {
    // decodeURIComponent throws on lone "%" — fail closed.
    expect(safeNext('/%')).toBe('/')
    expect(safeNext('/%ZZ')).toBe('/')
  })
  it('keeps a same-origin path even if it contains a safe percent-encoded segment', () => {
    // /me%2Fpublished decodes to /me/published — still same-origin,
    // still no traversal. We return the RAW value so the eventual
    // Location header round-trips intact.
    expect(safeNext('/me%2Fpublished')).toBe('/me%2Fpublished')
  })
  it('rejects ".." segments (defense-in-depth)', () => {
    expect(safeNext('/foo/../bar')).toBe('/')
    expect(safeNext('/../etc/passwd')).toBe('/')
    expect(safeNext('/foo/..')).toBe('/')
  })
  it('keeps a same-origin path with no traversal', () => {
    expect(safeNext('/me')).toBe('/me')
    expect(safeNext('/me/published')).toBe('/me/published')
  })
  it('coerces empty/null to "/"', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('')).toBe('/')
  })

  it('start endpoint coerces ?next=https://evil.com to /', async () => {
    const { onRequestGet } = await import('../functions/api/auth/[provider]/start')
    const env = envFor()
    const req = new Request('https://spool.share/api/auth/workos/start?next=https://evil.com')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env, { provider: 'workos' }))
    expect(res.status).toBe(302)
    const setCookies: string[] = res.headers.getSetCookie?.() ?? [
      res.headers.get('set-cookie') ?? '',
    ]
    const stateCookie = setCookies.find((c) => c.includes('__spool_oauth_state=')) ?? ''
    expect(stateCookie).toMatch(/__spool_oauth_state=[^|]+\|\/;/)
  })
})

// ────────────────────────────────────────────────────────────────────
// Rate limit: 31st publish/hour → 429
// ────────────────────────────────────────────────────────────────────

describe('publish rate limit', () => {
  it('31st call/hour → 429', async () => {
    const { onRequestPost } = await import('../functions/api/publish')
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const slot = Math.floor(Date.now() / 1000 / 3600)
    // Pre-fill the bucket to 30 (the cap).
    await env.RATE.put(`rate/publish-h/user-1/${slot}`, '30', { expirationTtl: 3600 * 2 })
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await onRequestPost(ctxFor(req, env))
    expect(res.status).toBe(429)
  })
})

// ────────────────────────────────────────────────────────────────────
// Admin audit endpoint
// ────────────────────────────────────────────────────────────────────

describe('GET /api/admin/audit', () => {
  it('403 when authed user is not in ADMIN_USER_IDS', async () => {
    const { onRequestGet } = await import('../functions/api/admin/audit')
    const env = { ...envFor(), ADMIN_USER_IDS: 'admin-a,admin-b' }
    seedUser(env.state, 'mortal')
    await seedSession(env.SESSIONS, TOKEN, 'mortal')
    const req = authedReq('https://x/api/admin/audit', undefined, 'GET')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(403)
  })

  it('401 when unauthenticated', async () => {
    const { onRequestGet } = await import('../functions/api/admin/audit')
    const env = { ...envFor(), ADMIN_USER_IDS: 'admin-a' }
    const req = new Request('https://x/api/admin/audit', { method: 'GET' })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(401)
  })

  it('200 + last 200 rows when caller is admin', async () => {
    const { onRequestGet } = await import('../functions/api/admin/audit')
    const env = { ...envFor(), ADMIN_USER_IDS: 'admin-a , admin-b' }
    seedUser(env.state, 'admin-a')
    await seedSession(env.SESSIONS, TOKEN, 'admin-a')
    // Seed a handful of audit rows.
    const baseTs = Date.now()
    for (let i = 0; i < 5; i++) {
      env.state.audit.push({
        user_id: 'someone',
        ip_hash: 'h',
        ua_hash: 'h',
        action: `evt-${i}`,
        target_id: null,
        details_json: null,
        ts: baseTs + i,
      })
    }
    const req = authedReq('https://x/api/admin/audit', undefined, 'GET')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (onRequestGet as any)(ctxFor(req, env))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: Array<{ action: string }> }
    expect(body.items.length).toBeGreaterThanOrEqual(5)
    // The admin call itself was audited.
    expect(env.state.audit.some((r) => r.action === 'admin.audit.read')).toBe(true)
    // Newest-first ordering.
    const ts = body.items.map((r) => (r as unknown as { ts: number }).ts)
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i - 1]).toBeGreaterThanOrEqual(ts[i]!)
    }
  })
})

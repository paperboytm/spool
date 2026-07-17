import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'

import type { SessionRecord } from '../src/auth/session'

import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

// Mock workers-og so tests don't try to load Satori/wasm in node.
const imageResponseCalls: Array<{ html: string; opts: unknown }> = []

vi.mock('workers-og', () => ({
  ImageResponse: vi.fn().mockImplementation((html: string, opts: unknown) => {
    imageResponseCalls.push({ html, opts })
    return {
      async arrayBuffer() {
        // Return a non-empty buffer so the caller can write it to R2.
        return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer
      },
    }
  }),
  // Tests don't exercise the Google Fonts network — stub to a tiny
  // ArrayBuffer so renderOgPng's font-load path completes without
  // actually fetching. The real subset-fetch is exercised in prod.
  loadGoogleFont: vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Uint8Array([0]).buffer)),
}))

const TOKEN = 'p'.repeat(40)

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

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  const snapshots = makeR2()
  const og = makeR2()
  return {
    DB: db,
    SESSIONS: makeKv(),
    META: makeKv(),
    RATE: makeKv(),
    SNAPSHOTS: snapshots.bucket,
    OG: og.bucket,
    state: s,
    _snapshots: snapshots.store,
    _og: og.store,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(req: Request, env: Record<string, unknown>, params: Record<string, string> = {}): any {
  const waits: Promise<unknown>[] = []
  return {
    request: req,
    env,
    next: async () => new Response('not-found', { status: 404 }),
    params,
    waitUntil: (p: Promise<unknown>) => { waits.push(p) },
    passThroughOnException: () => undefined,
    data: {},
    _waits: waits,
  }
}

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    source: {
      kind: 'spool-session',
      captured_at: new Date().toISOString(),
    },
    conversation: {
      title: 'A nice chat',
      turns: [
        { id: 't1', role: 'user', content: 'Hello.' },
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
    ...overrides,
  }
}

function authedReq(url: string, body?: unknown, token = TOKEN): Request {
  const init: RequestInit = {
    method: 'POST',
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

beforeEach(() => {
  imageResponseCalls.length = 0
})

describe('renderOgPng', () => {
  it('escapes HTML in the title before passing to ImageResponse', async () => {
    const { renderOgPng } = await import('../src/publish/og')
    await renderOgPng({
      conversation: { title: '<script>alert(1)</script>' },
      publish: { published_at: new Date().toISOString() },
      editor_opts: { template: 'forum', paper: 'cream', colorway: 'amber' },
    })
    expect(imageResponseCalls.length).toBe(1)
    const html = imageResponseCalls[0]!.html
    expect(html).not.toMatch(/<script>alert/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('returns a non-empty ArrayBuffer', async () => {
    const { renderOgPng } = await import('../src/publish/og')
    const buf = await renderOgPng({
      conversation: { title: 'hello' },
      publish: { published_at: new Date().toISOString() },
      editor_opts: { template: 'forum', paper: 'cream', colorway: 'amber' },
    })
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  it('truncates very long titles to 140 chars', async () => {
    const { buildOgHtml } = await import('../src/publish/og')
    const long = 'a'.repeat(500)
    const html = buildOgHtml({
      conversation: { title: long },
      publish: { published_at: new Date().toISOString() },
      editor_opts: { template: 'forum', paper: 'cream', colorway: 'amber' },
    })
    // count the run of 'a' characters in the html
    const m = html.match(/a+/g) ?? []
    const longest = Math.max(...m.map((s) => s.length))
    expect(longest).toBeLessThanOrEqual(140)
  })

  it('does not truncate inside an HTML entity when an & sits near the 140 boundary', async () => {
    // Pre-fix `escapeHtml(raw).slice(0,140)` could cut `&amp;` mid-entity
    // (e.g. into `&am`), emitting a garbled token. Slicing raw first then
    // escaping keeps every entity whole. Place a literal `&` at raw index
    // 139 so the escaped form `&amp;` would straddle the old 140 cutoff.
    const { clampTitle } = await import('../src/publish/og')
    const raw = 'a'.repeat(139) + '&' + 'b'.repeat(20)
    const out = clampTitle(raw)
    // The trailing `&` of the 140-char raw slice escapes to a full `&amp;`.
    expect(out.endsWith('&amp;')).toBe(true)
    // No dangling/partial entity anywhere: every `&` is the start of a
    // complete known entity.
    expect(out).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;)/)
    // Raw visible-char intent preserved: 140 source chars in, escaped out.
    expect(out).toBe('a'.repeat(139) + '&amp;')
  })

  it('emits zero whitespace between tags so Satori does not count them as child text nodes', async () => {
    // workers-og throws `Expected <div> to have explicit "display: flex"
    // or "display: none" if it has more than one child node` when a
    // multi-line template literal leaves whitespace between `</div>` and
    // the next `<div>`. The vitest mock for ImageResponse can't catch
    // this; assert string-level instead.
    const { buildOgHtml } = await import('../src/publish/og')
    const html = buildOgHtml({
      conversation: { title: 'hello' },
      publish: { published_at: new Date().toISOString() },
      editor_opts: { template: 'forum', paper: 'cream', colorway: 'amber' },
    })
    expect(html).not.toMatch(/>\s+</)
    // Sanity: still well-formed and contains the expected pieces.
    expect(html).toMatch(/^<div /)
    expect(html).toMatch(/<\/div>$/)
    expect(html.match(/<div /g)?.length).toBe(4)
  })
})

describe('GET /api/og/[id].png', () => {
  async function publishOne(env: ReturnType<typeof envFor>) {
    const { onRequestPost } = await import('../functions/api/publish')
    const ctx = ctxFor(
      authedReq('https://x/api/publish', { snapshot: makeSnapshot(), visibility: 'unlisted' }),
      env,
    )
    const res = await onRequestPost(ctx)
    // Drain ctx.waitUntil so the OG R2 write completes.
    await Promise.all(ctx._waits)
    return (await res.json()) as { id: string }
  }

  it('200 + image/png after publish', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    expect(env._og.has(`${id}.png`)).toBe(true)

    const { onRequestGet } = await import('../functions/api/og/[id].png')
    const req = new Request(`https://x/api/og/${id}.png`)
    const res = await onRequestGet(ctxFor(req, env, { id: `${id}.png` }))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    // Aligned with snapshots/[id].ts so a revoke takes the OG preview
    // off social platforms on the same timeline as the reader page.
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/max-age=30\b/)
    expect(cc).toMatch(/s-maxage=30\b/)
    expect(cc).toMatch(/must-revalidate/)
    expect(res.headers.get('etag')).toBe(`"${id}-1"`)
  })

  it('410 after revoke', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)

    const m = JSON.parse((await env.META.get(`meta/${id}`))!)
    m.revoked_at = Date.now()
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const { onRequestGet } = await import('../functions/api/og/[id].png')
    const req = new Request(`https://x/api/og/${id}.png`)
    const res = await onRequestGet(ctxFor(req, env, { id: `${id}.png` }))
    expect(res.status).toBe(410)
  })

  it('serves a legacy share whose KV meta still carries an old expires_at', async () => {
    // Expiry removed — stale legacy values are dead data, not a gate.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const m = JSON.parse((await env.META.get(`meta/${id}`))!)
    m.expires_at = Date.now() - 1000
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const { onRequestGet } = await import('../functions/api/og/[id].png')
    const req = new Request(`https://x/api/og/${id}.png`)
    const res = await onRequestGet(ctxFor(req, env, { id: `${id}.png` }))
    expect(res.status).toBe(200)
  })

  it('404 for bad slug', async () => {
    const env = envFor()
    const { onRequestGet } = await import('../functions/api/og/[id].png')
    const req = new Request('https://x/api/og/not-a-slug.png')
    const res = await onRequestGet(ctxFor(req, env, { id: 'not-a-slug.png' }))
    expect(res.status).toBe(404)
  })

  it('404 when meta exists but PNG missing', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    // Remove the PNG but keep meta.
    env._og.delete(`${id}.png`)

    const { onRequestGet } = await import('../functions/api/og/[id].png')
    const req = new Request(`https://x/api/og/${id}.png`)
    const res = await onRequestGet(ctxFor(req, env, { id: `${id}.png` }))
    expect(res.status).toBe(404)
  })
})

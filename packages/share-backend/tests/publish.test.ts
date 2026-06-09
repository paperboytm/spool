import { describe, expect, it, vi } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'

import { onRequestPost as publishPost } from '../functions/api/publish'
import { onRequestPost as revokePost } from '../functions/api/revoke/[id]'
import { onRequestGet as metaGet } from '../functions/api/meta/[id]'
import { onRequestGet as snapshotGet } from '../functions/api/snapshots/[id]'
import type { SessionRecord } from '../src/auth/session'
import { isValidSlug, nanoidSlug } from '../src/publish/slug'

import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

// Mock workers-og so publish.ts (which imports renderOgPng → workers-og)
// can be exercised in node without loading Satori/wasm.
vi.mock('workers-og', () => ({
  ImageResponse: vi.fn().mockImplementation(() => ({
    async arrayBuffer() {
      return new Uint8Array([137, 80, 78, 71]).buffer
    },
  })),
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
        { id: 't1', role: 'user', content: 'Hello there.' },
        { id: 't2', role: 'assistant', content: 'Hi!' },
      ],
      turn_order: ['t1', 't2'],
      hidden_turns: [],
    },
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
  // Auto-inject defaults for `draft_id` and `idempotency_key` on
  // /api/publish so the existing body fixtures don't all need to be
  // touched. Tests that explicitly exercise either contract should set
  // the field on the body directly (which takes precedence — we only
  // fill the gap). The default idempotency key is per-call-unique to
  // mirror the renderer (a real client hashes the payload, so the same
  // intent reuses the key; tests that need that reuse pass it explicitly).
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

// ────────────────────────────────────────────────────────────────────
// nanoidSlug + isValidSlug
// ────────────────────────────────────────────────────────────────────

describe('nanoidSlug', () => {
  it('returns length 21', () => {
    expect(nanoidSlug()).toHaveLength(21)
  })

  it('only contains [\\w-] characters', () => {
    for (let i = 0; i < 50; i++) {
      const s = nanoidSlug()
      expect(s).toMatch(/^[\w-]{21}$/)
    }
  })

  it('produces 1000 distinct values', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) seen.add(nanoidSlug())
    expect(seen.size).toBe(1000)
  })
})

describe('isValidSlug', () => {
  it('accepts a freshly generated slug', () => {
    expect(isValidSlug(nanoidSlug())).toBe(true)
  })
  it('rejects wrong length', () => {
    expect(isValidSlug('a'.repeat(20))).toBe(false)
    expect(isValidSlug('a'.repeat(22))).toBe(false)
  })
  it('rejects bad characters', () => {
    expect(isValidSlug('!'.repeat(21))).toBe(false)
    expect(isValidSlug('a/'.repeat(10) + 'a')).toBe(false)
  })
})

// ────────────────────────────────────────────────────────────────────
// POST /api/publish
// ────────────────────────────────────────────────────────────────────

describe('POST /api/publish', () => {
  it('401 when unauthenticated', async () => {
    const env = envFor()
    const req = new Request('https://x/api/publish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ snapshot: makeSnapshot(), visibility: 'unlisted' }),
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(401)
  })

  it('422 when payload exceeds 2MB', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const big = 'x'.repeat(2 * 1024 * 1024 + 10)
    const req = authedReq('https://x/api/publish', { snapshot: makeSnapshot(), visibility: 'unlisted', _pad: big })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { detail: string }).detail).toMatch(/too large/)
  })

  it('422 + zod issues when snapshot shape is invalid', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const bad = makeSnapshot()
    // Break the schema — title missing.
    delete (bad as { conversation: { title?: string } }).conversation.title
    const req = authedReq('https://x/api/publish', { snapshot: bad, visibility: 'unlisted' })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    const body = await res.json() as { issues?: unknown[] }
    expect(Array.isArray(body.issues)).toBe(true)
  })

  it('accepts content that contains literal credential-looking strings (no server rescan)', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const snap = makeSnapshot()
    // A literal Stripe-shaped key the client failed to redact / chose
    // to keep. The server no longer rescans — the client gate is the
    // sole boundary for what reaches R2 — so this must succeed.
    snap.conversation.turns = [
      { id: 't1', role: 'user', content: 'paste: sk_xxxx_aH1xK9pQrSt7VwYzA3bC5dF8gJ' },
    ]
    snap.conversation.turn_order = ['t1']
    const req = authedReq('https://x/api/publish', { snapshot: snap, visibility: 'unlisted' })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(200)
  })

  it('preserves turns[].redacted informational flag through R2', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const snap = makeSnapshot() as ReturnType<typeof makeSnapshot> & {
      conversation: { turns: Array<{ id: string; role: string; content: string; redacted?: boolean }> }
    }
    snap.conversation.turns = [
      { id: 't1', role: 'user', content: 'I emailed [redacted].', redacted: true },
      { id: 't2', role: 'assistant', content: 'Got it.' },
    ]
    snap.conversation.turn_order = ['t1', 't2']
    const req = authedReq('https://x/api/publish', { snapshot: snap, visibility: 'unlisted' })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string }
    const stored = env._snapshots.get(`${body.id}.json`)
    expect(stored).toBeTruthy()
    const full = JSON.parse(new TextDecoder().decode(stored!.bytes)) as {
      conversation: { turns: Array<{ id: string; redacted?: boolean }> }
    }
    expect(full.conversation.turns[0]!.redacted).toBe(true)
    expect(full.conversation.turns[1]!.redacted).toBeUndefined()
  })

  it('422 when visibility=profile-listed without a handle', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'profile-listed',
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { detail: string }).detail).toMatch(/handle/)
  })

  it('404 when republishing a slug not owned by the user', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const otherSlug = nanoidSlug()
    env.state.published_shares.push({
      id: otherSlug,
      user_id: 'someone-else',
      title: 'theirs',
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
      override_slug: otherSlug,
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(404)
  })

  it('429 when hourly cap is exceeded', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    // Mirror PUBLISH_RATE_HOURLY_{WINDOW_SEC,MAX} from publish.ts.
    const RATE_WINDOW_SEC = 3600
    const RATE_MAX = 30
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC)
    await env.RATE.put(`rate/publish-h/user-1/${slot}`, String(RATE_MAX), {
      expirationTtl: RATE_WINDOW_SEC * 2,
    })
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(429)
  })

  it('422 when expires_at is already in the past', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const past = new Date(Date.now() - 60_000).toISOString()
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
      expires_at: past,
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { detail: string }).detail).toMatch(/future/)
  })

  it('422 when expires_at is more than 1 year out', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const farFuture = new Date(Date.now() + 366 * 24 * 3600 * 1000).toISOString()
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
      expires_at: farFuture,
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    expect(((await res.json()) as { detail: string }).detail).toMatch(/1 year/)
  })

  it('expires_at at the 5-minute / 1-year boundaries: just-below = 422, just-above = 200', async () => {
    // Pin "now" indirectly: server reads Date.now() once at handler entry,
    // so we generate offsets relative to the very recent past. The 4-min
    // candidate is unambiguously inside the floor; the 6-min candidate is
    // unambiguously outside it; same logic at the 1-year ceiling.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const now = Date.now()
    const justBelowFloor = new Date(now + 4 * 60 * 1000).toISOString()
    const justAboveFloor = new Date(now + 6 * 60 * 1000).toISOString()
    const justBelowCeiling = new Date(now + (365 * 24 * 3600 - 60) * 1000).toISOString()
    const justAboveCeiling = new Date(now + (365 * 24 * 3600 + 600) * 1000).toISOString()

    const cases: Array<{ at: string; status: number }> = [
      { at: justBelowFloor, status: 422 },
      { at: justAboveFloor, status: 200 },
      { at: justBelowCeiling, status: 200 },
      { at: justAboveCeiling, status: 422 },
    ]
    for (const c of cases) {
      const req = authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        expires_at: c.at,
      })
      const res = await invoke(publishPost, req, env)
      expect(res.status, `expires_at=${c.at}`).toBe(c.status)
    }
  })

  it('422 when turn_order length does not match turns count', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const snap = makeSnapshot()
    // 2 turns but turn_order names 3 entries — reader would render
    // missing content otherwise.
    snap.conversation.turn_order = ['t1', 't2', 't3']
    const req = authedReq('https://x/api/publish', { snapshot: snap, visibility: 'unlisted' })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
    const body = (await res.json()) as { issues: Array<{ message: string }> }
    expect(body.issues.some((i) => /turn_order/.test(i.message))).toBe(true)
  })

  it('422 when turn_order references a turn id that does not exist', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const snap = makeSnapshot()
    snap.conversation.turn_order = ['t1', 'nope']
    const req = authedReq('https://x/api/publish', { snapshot: snap, visibility: 'unlisted' })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
  })

  it('returns the share URL using PUBLIC_BASE_URL when present', async () => {
    const env = { ...envFor(), PUBLIC_BASE_URL: 'http://localhost:5173' }
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toMatch(/^http:\/\/localhost:5173\/s\//)
  })

  it('happy path: snapshot in R2, KV meta written, D1 row inserted, slug returned', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(200)
    const body = await res.json() as { id: string; version: number; url: string }
    expect(isValidSlug(body.id)).toBe(true)
    expect(body.version).toBe(1)
    expect(body.url).toBe(`https://spool.pro/s/${body.id}`)

    expect(env._snapshots.has(`${body.id}.json`)).toBe(true)
    const metaRaw = await env.META.get(`meta/${body.id}`)
    expect(metaRaw).not.toBeNull()
    const meta = JSON.parse(metaRaw!) as { owner: string; version: number; revoked_at: number | null; title: string | null }
    expect(meta.owner).toBe('user-1')
    expect(meta.version).toBe(1)
    expect(meta.revoked_at).toBeNull()
    // Title is the whole point of the meta sidecar — assert it lands
    // in KV at the publish layer so a typo on the publish.ts side
    // surfaces here rather than only at the /api/meta read layer.
    expect(meta.title).toBe('A nice chat')

    const row = env.state.published_shares.find((s) => s.id === body.id)
    expect(row).toBeTruthy()
    expect(row?.user_id).toBe('user-1')
    expect(row?.version).toBe(1)
    expect(env.state.audit.some((a) => a.action === 'publish' && a.target_id === body.id)).toBe(true)
  })

  it('does not leak owner_user_id in the public snapshot JSON', async () => {
    // owner_user_id used to be embedded in the R2 body — a free pivot
    // point for anyone with a share URL. Author identity now belongs
    // exclusively to /api/profiles/* (joinable by handle, not by raw id).
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    const body = (await res.json()) as { id: string }
    const stored = env._snapshots.get(`${body.id}.json`)!
    const full = JSON.parse(new TextDecoder().decode(stored.bytes)) as Record<string, unknown>
    expect(full).not.toHaveProperty('owner_user_id')
  })
})

// ────────────────────────────────────────────────────────────────────
// GET /api/snapshots/[id]
// ────────────────────────────────────────────────────────────────────

describe('GET /api/snapshots/[id]', () => {
  async function publishOne(env: ReturnType<typeof envFor>) {
    const req = authedReq('https://x/api/publish', {
      snapshot: makeSnapshot(),
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    return (await res.json()) as { id: string; version: number }
  }

  it('200 + JSON body after publish', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)

    const req = new Request(`https://x/api/snapshots/${id}`)
    const res = await invoke(snapshotGet, req, env, { id })
    expect(res.status).toBe(200)
    expect(res.headers.get('etag')).toBe(`"${id}-1"`)
    const body = await res.json() as { id: string; publish: { version: number } }
    expect(body.id).toBe(id)
    expect(body.publish.version).toBe(1)
  })

  it('sets a short, must-revalidate cache so revokes propagate within 30s', async () => {
    // Reader CDN entry MUST expire fast enough that a panic revoke isn't
    // stuck behind a long shared cache. 30s is the agreed budget.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const req = new Request(`https://x/api/snapshots/${id}`)
    const res = await invoke(snapshotGet, req, env, { id })
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/max-age=30\b/)
    expect(cc).toMatch(/s-maxage=30\b/)
    expect(cc).toMatch(/must-revalidate/)
  })

  it('410 + tombstone JSON after revoke', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)

    // Mark revoked in KV (revoke endpoint test below covers the full path).
    const metaRaw = (await env.META.get(`meta/${id}`))!
    const m = JSON.parse(metaRaw)
    m.revoked_at = Date.now()
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const req = new Request(`https://x/api/snapshots/${id}`)
    const res = await invoke(snapshotGet, req, env, { id })
    expect(res.status).toBe(410)
    const body = await res.json() as { revoked: boolean; at: number }
    expect(body.revoked).toBe(true)
    expect(typeof body.at).toBe('number')
  })

  it('404 for badly shaped slug', async () => {
    const env = envFor()
    const req = new Request('https://x/api/snapshots/not-a-slug')
    const res = await invoke(snapshotGet, req, env, { id: 'not-a-slug' })
    expect(res.status).toBe(404)
  })

  it('410 when expired', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const m = JSON.parse((await env.META.get(`meta/${id}`))!)
    m.expires_at = Date.now() - 1000
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const req = new Request(`https://x/api/snapshots/${id}`)
    const res = await invoke(snapshotGet, req, env, { id })
    expect(res.status).toBe(410)
    const body = await res.json() as { expired: boolean }
    expect(body.expired).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────
// GET /api/meta/[id] — lightweight title + lifecycle sidecar
// ────────────────────────────────────────────────────────────────────

describe('GET /api/meta/[id]', () => {
  async function publishOne(env: ReturnType<typeof envFor>, title = 'A nice chat') {
    const snap = makeSnapshot()
    snap.conversation.title = title
    const req = authedReq('https://x/api/publish', {
      snapshot: snap,
      visibility: 'unlisted',
    })
    const res = await invoke(publishPost, req, env)
    return (await res.json()) as { id: string; version: number }
  }

  it('200 with title from the KV meta record (no R2 snapshot fetch)', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env, 'Hello world')

    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    expect(res.status).toBe(200)
    const body = await res.json() as {
      title: string | null
      visibility: string
      expires_at: number | null
      version: number
    }
    expect(body.title).toBe('Hello world')
    expect(body.visibility).toBe('unlisted')
    expect(body.expires_at).toBeNull()
    expect(body.version).toBe(1)
    expect(res.headers.get('etag')).toBe(`"${id}-1"`)
  })

  it('does NOT leak the owner user id', async () => {
    // Owner field belongs to the internal KV record; exposing it here
    // would let anyone with a slug pivot to a user-enumeration vector
    // via /api/profiles/*. Mirror the public-shape discipline applied
    // to /api/snapshots/:id.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    const body = await res.json() as Record<string, unknown>
    expect(body.owner).toBeUndefined()
    expect(body.user_id).toBeUndefined()
  })

  it('410 + tombstone JSON after revoke', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)

    const metaRaw = (await env.META.get(`meta/${id}`))!
    const m = JSON.parse(metaRaw)
    m.revoked_at = Date.now()
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    expect(res.status).toBe(410)
    const body = await res.json() as { revoked: boolean }
    expect(body.revoked).toBe(true)
  })

  it('410 + expired JSON after expires_at', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const m = JSON.parse((await env.META.get(`meta/${id}`))!)
    m.expires_at = Date.now() - 1000
    await env.META.put(`meta/${id}`, JSON.stringify(m))

    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    expect(res.status).toBe(410)
    const body = await res.json() as { expired: boolean }
    expect(body.expired).toBe(true)
  })

  it('404 when KV record is missing', async () => {
    const env = envFor()
    const id = 'abcdefghijklmnopqrstu' // 21-char valid slug shape, no row
    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    expect(res.status).toBe(404)
  })

  it('404 for badly shaped slug (no KV round-trip)', async () => {
    const env = envFor()
    const req = new Request('https://x/api/meta/not-a-slug')
    const res = await invoke(metaGet, req, env, { id: 'not-a-slug' })
    expect(res.status).toBe(404)
  })

  it('serves null title on legacy shares published before the field landed', async () => {
    // Pre-existing shares (pre-feat/share-og-meta-sidecar) have a KV
    // record without the `title` field. Endpoint returns 200 with
    // title: null — caller renders without a custom OG title (the
    // og:image is built independently and still works).
    const env = envFor()
    const id = 'legacysharelegacyshrx' // 21-char slug
    await env.META.put(`meta/${id}`, JSON.stringify({
      owner: 'user-1',
      visibility: 'unlisted',
      expires_at: null,
      revoked_at: null,
      version: 1,
    }))
    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    expect(res.status).toBe(200)
    const body = await res.json() as { title: string | null }
    expect(body.title).toBeNull()
  })

  it('sets the same 30s must-revalidate cache as /api/snapshots/:id', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const { id } = await publishOne(env)
    const req = new Request(`https://x/api/meta/${id}`)
    const res = await invoke(metaGet, req, env, { id })
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/max-age=30\b/)
    expect(cc).toMatch(/s-maxage=30\b/)
    expect(cc).toMatch(/must-revalidate/)
  })
})

// ────────────────────────────────────────────────────────────────────
// Republish + revoke wiring
// ────────────────────────────────────────────────────────────────────

describe('republish + revoke', () => {
  it('republish increments version, updates KV/R2, writes audit row', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')

    const firstRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', { snapshot: makeSnapshot(), visibility: 'unlisted' }),
      env,
    )
    const first = await firstRes.json() as { id: string; version: number }
    expect(first.version).toBe(1)

    const updated = makeSnapshot()
    updated.conversation.title = 'Edited title'
    const secondRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: updated,
        visibility: 'unlisted',
        override_slug: first.id,
      }),
      env,
    )
    const second = await secondRes.json() as { id: string; version: number }
    expect(second.id).toBe(first.id)
    expect(second.version).toBe(2)

    // D1 row updated, title changed, republished_at set.
    const row = env.state.published_shares.find((s) => s.id === first.id)
    expect(row?.version).toBe(2)
    expect(row?.title).toBe('Edited title')
    expect(row?.republished_at).toBeTruthy()

    // KV meta version bumped.
    const meta = JSON.parse((await env.META.get(`meta/${first.id}`))!) as { version: number }
    expect(meta.version).toBe(2)

    // R2 snapshot replaced.
    const stored = env._snapshots.get(`${first.id}.json`)
    expect(stored).toBeTruthy()
    const fullSnap = JSON.parse(new TextDecoder().decode(stored!.bytes)) as { publish: { version: number } }
    expect(fullSnap.publish.version).toBe(2)

    // Two audit rows: one publish, one republish.
    expect(env.state.audit.filter((a) => a.action === 'publish').length).toBe(1)
    expect(env.state.audit.filter((a) => a.action === 'republish').length).toBe(1)
  })

  it('409 when a concurrent republish bumps version before the UPDATE lands', async () => {
    // Reproduces the SELECT-then-UPDATE race: the handler reads version=1,
    // computes v=2, and tries to write WHERE version=1. Another worker
    // landed a republish first (version is now 2) → UPDATE matches 0 rows
    // → optimistic-concurrency check turns it into 409 instead of silently
    // clobbering the winner.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')

    const firstRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', { snapshot: makeSnapshot(), visibility: 'unlisted' }),
      env,
    )
    const first = await firstRes.json() as { id: string }

    // Force the WHERE version=? clause to miss by mutating the stored
    // row's version *after* the seeded SELECT path would observe v=1.
    // Real-D1: a concurrent UPDATE landed in the same window. Test-D1:
    // we just intercept the UPDATE to return changes=0.
    const realPrepare = env.DB.prepare.bind(env.DB)
    const intercept = (sql: string) => {
      const stmt = realPrepare(sql)
      if (/^UPDATE published_shares SET title=\?, visibility=\?/i.test(sql)) {
        return {
          bind: () => ({
            run: async () => ({ success: true, meta: { changes: 0 } }),
          }),
        } as unknown as ReturnType<typeof realPrepare>
      }
      return stmt
    }
    ;(env.DB as unknown as { prepare: typeof realPrepare }).prepare =
      intercept as unknown as typeof realPrepare

    const res = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        override_slug: first.id,
      }),
      env,
    )
    expect(res.status).toBe(409)
  })

  it('404 when republishing a slug that is already revoked', async () => {
    // The SELECT inside publish.ts filters `revoked_at IS NULL`, so a
    // revoked share looks like "not found" to the republish path even
    // though the row physically exists. Without this guard a user could
    // un-tombstone a revoked share by re-asserting it at v(N+1).
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const slug = nanoidSlug()
    env.state.published_shares.push({
      id: slug,
      user_id: 'user-1',
      title: 'mine',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: Date.now() - 60_000,
      republished_at: null,
      revoked_at: Date.now() - 1000,
    })
    const res = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        override_slug: slug,
      }),
      env,
    )
    expect(res.status).toBe(404)
  })

  it('revoke marks meta + D1 and read returns 410', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const pRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', { snapshot: makeSnapshot(), visibility: 'unlisted' }),
      env,
    )
    const { id } = await pRes.json() as { id: string }

    const revokeReq = authedReq(`https://x/api/revoke/${id}`)
    const revokeRes = await invoke(revokePost, revokeReq, env, { id })
    expect(revokeRes.status).toBe(200)

    const row = env.state.published_shares.find((s) => s.id === id)
    expect(row?.revoked_at).toBeTruthy()
    const meta = JSON.parse((await env.META.get(`meta/${id}`))!) as { revoked_at: number }
    expect(typeof meta.revoked_at).toBe('number')
    expect(env.state.audit.some((a) => a.action === 'revoke' && a.target_id === id)).toBe(true)

    const getReq = new Request(`https://x/api/snapshots/${id}`)
    const getRes = await invoke(snapshotGet, getReq, env, { id })
    expect(getRes.status).toBe(410)
  })

  it('revoke 429 when the per-user hourly cap is exceeded', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const slug = nanoidSlug()
    env.state.published_shares.push({
      id: slug,
      user_id: 'user-1',
      title: 'mine',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: Date.now(),
      republished_at: null,
      revoked_at: null,
    })
    // Mirror REVOKE_RATE_{WINDOW_SEC,MAX} from revoke/[id].ts.
    const RATE_WINDOW_SEC = 3600
    const RATE_MAX = 60
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC)
    await env.RATE.put(`rate/revoke/user-1/${slot}`, String(RATE_MAX), {
      expirationTtl: RATE_WINDOW_SEC * 2,
    })
    const req = authedReq(`https://x/api/revoke/${slug}`)
    const res = await invoke(revokePost, req, env, { id: slug })
    expect(res.status).toBe(429)
  })

  it('revoke is idempotent on an already-revoked share — 200, original revoked_at preserved', async () => {
    // Cross-device unpublish: user revokes on web at T0, opens the
    // desktop app at T1 with a stale cache showing the share as live,
    // clicks Unpublish → backend must return 200 (so the desktop UI
    // doesn't toast an error for a no-op the user already performed)
    // AND must NOT overwrite the original revoked_at (preserves the
    // audit trail and the 7-day orphan-sweep window from the first
    // revoke).
    const env = envFor()
    seedUser(env.state, 'user-1')
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const slug = nanoidSlug()
    const originalRevokedAt = Date.now() - 1000 * 60 * 60 // 1h ago
    env.state.published_shares.push({
      id: slug,
      user_id: 'user-1',
      title: 'old',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: originalRevokedAt - 1000,
      republished_at: null,
      revoked_at: originalRevokedAt,
    })
    const req = authedReq(`https://x/api/revoke/${slug}`)
    const res = await invoke(revokePost, req, env, { id: slug })
    expect(res.status).toBe(200)
    const row = env.state.published_shares.find((r) => r.id === slug)!
    expect(row.revoked_at).toBe(originalRevokedAt)
  })

  it('revoke 404 when slug is not owned', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'user-2')
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const otherSlug = nanoidSlug()
    env.state.published_shares.push({
      id: otherSlug,
      user_id: 'user-2',
      title: 'theirs',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: Date.now(),
      republished_at: null,
      revoked_at: null,
    })
    const req = authedReq(`https://x/api/revoke/${otherSlug}`)
    const res = await invoke(revokePost, req, env, { id: otherSlug })
    expect(res.status).toBe(404)
  })
})

// ────────────────────────────────────────────────────────────────────
// Publish idempotency (client_request_id)
// ────────────────────────────────────────────────────────────────────

describe('POST /api/publish — idempotency', () => {
  it('returns the same slug + version when the same token is sent twice', async () => {
    // Drives the "renderer's response dropped mid-flight" scenario:
    // the user clicks Publish again with the same payload, so the same
    // content hash, so the backend short-circuits to the original row
    // instead of creating a second share.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const key = 'fixed-idemp-token-abc123'

    const first = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: key,
      }),
      env,
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { id: string; version: number }

    const second = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: key,
      }),
      env,
    )
    expect(second.status).toBe(200)
    const secondBody = (await second.json()) as { id: string; version: number }

    expect(secondBody.id).toBe(firstBody.id)
    expect(secondBody.version).toBe(firstBody.version)
    // No duplicate row written.
    expect(env.state.published_shares.length).toBe(1)
    // No second audit row (the short-circuit returns before the audit
    // call, so the evidence of work mirrors what actually happened).
    expect(env.state.audit.filter((a) => a.action === 'publish').length).toBe(1)
  })

  it('mints a new slug when a different token is sent for fresh content', async () => {
    // The re-edited-intent path: user fails, edits something, retries.
    // Different content hash ⇒ different token ⇒ a fresh publish is
    // the correct behavior, not a short-circuit.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')

    const first = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: 'token-AAAAA',
      }),
      env,
    )
    const second = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: 'token-BBBBB',
      }),
      env,
    )
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    const a = (await first.json()) as { id: string }
    const b = (await second.json()) as { id: string }
    expect(b.id).not.toBe(a.id)
    expect(env.state.published_shares.length).toBe(2)
  })

  it('ignores revoked rows when matching the token', async () => {
    // A token that belonged to a revoked share must NOT short-circuit
    // a fresh publish; otherwise revoke-then-publish-again would
    // silently resurrect the tombstone (and 410 the user's "live" link).
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const key = 'reused-token'

    const first = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: key,
      }),
      env,
    )
    const original = (await first.json()) as { id: string }
    // Tombstone the first share manually (simulates an explicit revoke).
    const row = env.state.published_shares.find((s) => s.id === original.id)
    row!.revoked_at = Date.now()

    const second = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: key,
      }),
      env,
    )
    expect(second.status).toBe(200)
    const fresh = (await second.json()) as { id: string }
    expect(fresh.id).not.toBe(original.id)
    expect(env.state.published_shares.length).toBe(2)
  })

  it('republish carries the new token through to the row', async () => {
    // Republish from the editor: same slug (via override_slug), but a
    // fresh content hash from edits. After the UPDATE lands, the
    // row's stored token is the NEW one; a re-retry of the republish
    // with the new token short-circuits, but a re-retry of the ORIGINAL
    // token would not (which is fine — the original intent's response
    // was either already received or has long expired by now).
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')

    const first = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        idempotency_key: 'token-AAAAA',
      }),
      env,
    )
    const a = (await first.json()) as { id: string }

    const republished = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        override_slug: a.id,
        idempotency_key: 'token-BBBBB',
      }),
      env,
    )
    expect(republished.status).toBe(200)
    const row = env.state.published_shares.find((s) => s.id === a.id)
    expect(row?.client_request_id).toBe('token-BBBBB')
    expect(row?.version).toBe(2)
  })

  it('409 when republish lands a token already held by another live share', async () => {
    // Two distinct drafts for the same user that happen to share
    // identical snapshot+visibility+expires content hash to the same
    // idempotency token. A republish that tries to bind the token to
    // a *different* live row would violate UNIQUE(user_id,
    // client_request_id). We want a clean 409 with a meaningful
    // message, not a 500 leaking the raw constraint error string.
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const sharedToken = 'sharedtoken-12345'

    const aRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        draft_id: 'draft-A',
        idempotency_key: sharedToken,
      }),
      env,
    )
    expect(aRes.status).toBe(200)
    const a = (await aRes.json()) as { id: string }

    const bRes = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        draft_id: 'draft-B',
        // Different token so the INSERT succeeds; this share is the
        // "another live share" the republish is about to collide with.
        idempotency_key: 'distinct-other-token',
      }),
      env,
    )
    expect(bRes.status).toBe(200)
    const b = (await bRes.json()) as { id: string }

    // Now republish B with the SAME token A already holds. The
    // partial unique index fires on the UPDATE.
    const collide = await invoke(
      publishPost,
      authedReq('https://x/api/publish', {
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        draft_id: 'draft-B',
        idempotency_key: sharedToken,
        override_slug: b.id,
      }),
      env,
    )
    expect(collide.status).toBe(409)
    // A's row still carries the original token.
    const aRow = env.state.published_shares.find((s) => s.id === a.id)
    expect(aRow?.client_request_id).toBe(sharedToken)
    // B's row is untouched (still at version 1, original token).
    const bRow = env.state.published_shares.find((s) => s.id === b.id)
    expect(bRow?.version).toBe(1)
    expect(bRow?.client_request_id).toBe('distinct-other-token')
  })

  it('422 when idempotency_key is missing or too short', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    // Build the body manually so the test helper doesn't auto-fill.
    const req = new Request('https://x/api/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'application/json',
        'CF-Connecting-IP': '1.2.3.4',
      },
      body: JSON.stringify({
        snapshot: makeSnapshot(),
        visibility: 'unlisted',
        draft_id: 'test-draft-id',
        // idempotency_key absent — zod min(8) should reject.
      }),
    })
    const res = await invoke(publishPost, req, env)
    expect(res.status).toBe(422)
  })
})
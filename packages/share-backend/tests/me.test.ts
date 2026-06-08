import { describe, expect, it } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'

import { onRequestGet as checkHandleGet } from '../functions/api/handles/check'
import { onRequestPost as claimHandlePost } from '../functions/api/handles/claim'
import {
  onRequestDelete as cancelDelete,
  onRequestPost as scheduleDelete,
} from '../functions/api/me/delete'
import { onRequestGet as meGet } from '../functions/api/me/index'
import { onRequestGet as meSharesGet } from '../functions/api/me/shares'
import { requireUser } from '../src/auth/require'
import type { SessionRecord } from '../src/auth/session'
import { ApiError } from '../src/errors'

import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

function seedUser(
  state: FakeDbState,
  overrides: Partial<FakeDbState['users'][number]> = {},
): FakeDbState['users'][number] {
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    name: 'Alice',
    avatar_url: 'https://x/a.png',
    created_at: Date.now(),
    last_signin_at: Date.now(),
    deletion_pending_until: null,
    deleted_at: null,
    ...overrides,
  }
  state.users.push(user)
  return user
}

const SESSION_TTL_SEC = 30 * 24 * 3600
const SESSION_TTL_MS = SESSION_TTL_SEC * 1000
const GRACE_PERIOD_MS = 24 * 3600 * 1000

async function seedSession(
  kv: KVNamespace,
  token: string,
  user_id: string,
): Promise<void> {
  const now = Date.now()
  const rec: SessionRecord = {
    user_id,
    created: now,
    exp: now + SESSION_TTL_MS,
    last_seen: now,
  }
  await kv.put(`session/${token}`, JSON.stringify(rec), {
    expirationTtl: SESSION_TTL_SEC,
  })
}

// Token length must clear loadSession's MIN_TOKEN_CHARS guard (32).
const TOKEN = 'a'.repeat(40)

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  return {
    DB: db,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    state: s,
  }
}

function authedReq(url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  headers.set('CF-Connecting-IP', '1.2.3.4')
  return new Request(url, { ...init, headers })
}

describe('requireUser', () => {
  it('401 when no token at all', async () => {
    const env = envFor()
    const req = new Request('https://x/')
    await expect(requireUser(req, env)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('401 when bearer token has no KV session', async () => {
    const env = envFor()
    seedUser(env.state)
    const req = authedReq('https://x/')
    await expect(requireUser(req, env)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('accepts bearer auth', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/')
    const user = await requireUser(req, env)
    expect(user.id).toBe('user-1')
  })

  it('accepts cookie auth', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = new Request('https://x/', {
      headers: { cookie: `spool_session=${TOKEN}` },
    })
    const user = await requireUser(req, env)
    expect(user.id).toBe('user-1')
  })

  it('bearer takes precedence over cookie', async () => {
    const env = envFor()
    seedUser(env.state, { id: 'user-bearer' })
    seedUser(env.state, { id: 'user-cookie', email: 'c@c' })
    const bearerToken = 'b'.repeat(40)
    const cookieToken = 'c'.repeat(40)
    await seedSession(env.SESSIONS, bearerToken, 'user-bearer')
    await seedSession(env.SESSIONS, cookieToken, 'user-cookie')
    const req = new Request('https://x/', {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        cookie: `spool_session=${cookieToken}`,
      },
    })
    const user = await requireUser(req, env)
    expect(user.id).toBe('user-bearer')
  })

  it('403 when deletion_pending_until is set', async () => {
    const env = envFor()
    seedUser(env.state, { deletion_pending_until: Date.now() + 1000 })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/')
    await expect(requireUser(req, env)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('GET /api/handles/check', () => {
  it('returns available=true for an unclaimed valid handle', async () => {
    const env = envFor()
    const req = new Request('https://x/api/handles/check?h=alice')
    const res = await invoke(checkHandleGet, req, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: true })
  })

  it('returns available=false for a taken handle', async () => {
    const env = envFor()
    env.state.handles.push({
      handle: 'alice',
      user_id: 'someone',
      claimed_at: Date.now(),
      released_at: null,
    })
    const req = new Request('https://x/api/handles/check?h=alice')
    const res = await invoke(checkHandleGet, req, env)
    expect(await res.json()).toEqual({ available: false })
  })

  it('returns invalid reason for bad format', async () => {
    const env = envFor()
    const req = new Request('https://x/api/handles/check?h=2bad')
    const res = await invoke(checkHandleGet, req, env)
    const body = (await res.json()) as { available: boolean; reason: string }
    expect(body.available).toBe(false)
    expect(body.reason).toBe('invalid format')
  })

  it('returns reserved reason for admin', async () => {
    const env = envFor()
    const req = new Request('https://x/api/handles/check?h=admin')
    const res = await invoke(checkHandleGet, req, env)
    const body = (await res.json()) as { available: boolean; reason: string }
    expect(body.reason).toBe('reserved')
  })
})

describe('POST /api/handles/claim', () => {
  it('claims an available handle and writes audit', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ handle: 'alice' })
    expect(env.state.handles).toHaveLength(1)
    expect(env.state.handles[0]?.handle).toBe('alice')
    expect(
      env.state.audit.some(
        (a) => a.action === 'handle.claim' && a.target_id === 'alice',
      ),
    ).toBe(true)
  })

  it('401 when unauthenticated', async () => {
    const env = envFor()
    const req = new Request('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(401)
  })

  it('409 when another user already owns the handle', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'other',
      claimed_at: Date.now(),
      released_at: null,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(409)
  })

  it('idempotent: same user re-claiming their own handle returns 200', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now() - 1000,
      released_at: null,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(200)
    expect(env.state.handles).toHaveLength(1)
  })

  it('409 when user already has a different handle', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'other',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(409)
  })

  it('422 on invalid handle format', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: '2bad' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(422)
  })

  it('429 when rate limit exceeded', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    // Mirror CLAIM_RATE_{WINDOW_SEC, MAX} from claim.ts.
    const RATE_WINDOW_SEC = 86400
    const RATE_MAX = 5
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC)
    await env.RATE.put(`rate/claim/user-1/${slot}`, String(RATE_MAX), {
      expirationTtl: RATE_WINDOW_SEC * 2,
    })
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(429)
  })

  it('409 (not 500) when INSERT races with another claim — PK violation maps to CONFLICT', async () => {
    // Reproduces the TOCTOU window between the pre-flight SELECT (which
    // filters released_at IS NULL) and the INSERT (which collides on the
    // PK regardless of released_at). A released-handle row satisfies both
    // sides of that mismatch in a single deterministic setup.
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'other',
      claimed_at: Date.now() - 10000,
      released_at: Date.now() - 1000,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/handles/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'alice' }),
    })
    const res = await invoke(claimHandlePost, req, env)
    expect(res.status).toBe(409)
  })
})

describe('GET /api/me', () => {
  it('returns user + handle null when none claimed', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me')
    const res = await invoke(meGet, req, env)
    expect(res.status).toBe(200)
    // v0.6 added the resolved-profile fields (display_name +
    // display_name_override + custom_avatar_id + avatar_visible). A
    // fresh user with no override sees display_name fall through to
    // the provider claim and avatar_visible defaulting to true.
    expect(await res.json()).toEqual({
      id: 'user-1',
      email: 'a@example.com',
      name: 'Alice',
      display_name: 'Alice',
      display_name_override: null,
      avatar_url: 'https://x/a.png',
      custom_avatar_id: null,
      avatar_visible: true,
      handle: null,
      deletion_pending_until: null,
    })
  })

  it('returns user + claimed handle when present', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me')
    const res = await invoke(meGet, req, env)
    const body = (await res.json()) as { handle: string | null }
    expect(body.handle).toBe('alice')
  })

  it('401 when unauthenticated', async () => {
    const env = envFor()
    const req = new Request('https://x/api/me')
    const res = await invoke(meGet, req, env)
    expect(res.status).toBe(401)
  })

  it('200 (not 403) when deletion is pending, surfaces deletion_pending_until', async () => {
    // Cross-device case: the user scheduled deletion on web, then opened
    // the desktop app. /api/me must still answer so the app can render
    // the Cancel-deletion CTA — every other endpoint stays locked.
    const env = envFor()
    const pendingUntil = Date.now() + 12 * 3600 * 1000
    seedUser(env.state, { deletion_pending_until: pendingUntil })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me')
    const res = await invoke(meGet, req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { deletion_pending_until: number | null }
    expect(body.deletion_pending_until).toBe(pendingUntil)
  })
})

describe('GET /api/me/shares', () => {
  it('returns empty list when no shares', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me/shares')
    const res = await invoke(meSharesGet, req, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ items: [] })
  })

  it('returns published_shares ordered by published_at desc', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.published_shares.push(
      {
        id: 'old',
        user_id: 'user-1',
        title: 'Old',
        visibility: 'unlisted',
        expires_at: null,
        version: 1,
        published_at: 100,
        republished_at: null,
        revoked_at: null,
      },
      {
        id: 'new',
        user_id: 'user-1',
        title: 'New',
        visibility: 'profile-listed',
        expires_at: null,
        version: 1,
        published_at: 200,
        republished_at: null,
        revoked_at: null,
      },
      {
        id: 'someone-else',
        user_id: 'other',
        title: 'Other',
        visibility: 'unlisted',
        expires_at: null,
        version: 1,
        published_at: 300,
        republished_at: null,
        revoked_at: null,
      },
    )
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me/shares')
    const res = await invoke(meSharesGet, req, env)
    const body = (await res.json()) as { items: Array<{ id: string }> }
    expect(body.items.map((i) => i.id)).toEqual(['new', 'old'])
  })
})

describe('POST /api/me/delete', () => {
  it('sets deletion_pending_until, inserts queue row, audits', async () => {
    const env = envFor()
    seedUser(env.state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const before = Date.now()
    const req = authedReq('https://x/api/me/delete', { method: 'POST' })
    const res = await invoke(scheduleDelete, req, env)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { scheduled_at: number }
    // Allow a small clock skew (1s) between Date.now() reads.
    expect(body.scheduled_at).toBeGreaterThanOrEqual(before + GRACE_PERIOD_MS - 1000)
    expect(env.state.users[0]?.deletion_pending_until).toBe(body.scheduled_at)
    expect(env.state.deletion_queue).toHaveLength(1)
    expect(env.state.deletion_queue[0]).toMatchObject({
      user_id: 'user-1',
      cancelled: 0,
    })
    expect(env.state.audit.some((a) => a.action === 'account.delete.scheduled')).toBe(
      true,
    )
  })

  it('INSERT OR REPLACE overwrites prior queue row', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: 1,
      cancelled: 1,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me/delete', { method: 'POST' })
    await invoke(scheduleDelete, req, env)
    expect(env.state.deletion_queue).toHaveLength(1)
    expect(env.state.deletion_queue[0]?.cancelled).toBe(0)
    expect(env.state.deletion_queue[0]?.scheduled_at).toBeGreaterThan(1)
  })
})

describe('DELETE /api/me/delete', () => {
  it('clears pending and marks queue row cancelled even while deletion is pending', async () => {
    const env = envFor()
    seedUser(env.state)
    const pendingUntil = Date.now() + GRACE_PERIOD_MS / 2
    env.state.users[0]!.deletion_pending_until = pendingUntil
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: pendingUntil,
      cancelled: 0,
    })
    await seedSession(env.SESSIONS, TOKEN, 'user-1')
    const req = authedReq('https://x/api/me/delete', { method: 'DELETE' })
    const res = await invoke(cancelDelete, req, env)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ cancelled: true })
    expect(env.state.users[0]?.deletion_pending_until).toBeNull()
    expect(env.state.deletion_queue[0]?.cancelled).toBe(1)
    expect(env.state.audit.some((a) => a.action === 'account.delete.cancel')).toBe(true)
  })
})

describe('ApiError surfacing', () => {
  it('UNAUTHENTICATED maps to 401', () => {
    expect(new ApiError('UNAUTHENTICATED').code).toBe('UNAUTHENTICATED')
  })
})

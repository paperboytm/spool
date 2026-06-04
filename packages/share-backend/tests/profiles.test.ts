import { describe, expect, it } from 'vitest'

import { onRequestGet as profileGet } from '../functions/api/profiles/[handle]'

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

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  return { DB: db, SESSIONS: makeKv(), RATE: makeKv(), state: s }
}

describe('GET /api/profiles/:handle', () => {
  it('404 for an invalid handle (not 422 — avoid leaking invalid vs missing)', async () => {
    const env = envFor()
    const req = new Request('https://x/api/profiles/2bad')
    const res = await invoke(profileGet, req, env, { handle: '2bad' })
    expect(res.status).toBe(404)
  })

  it('404 for a reserved handle', async () => {
    const env = envFor()
    const req = new Request('https://x/api/profiles/admin')
    const res = await invoke(profileGet, req, env, { handle: 'admin' })
    expect(res.status).toBe(404)
  })

  it('404 for a nonexistent handle', async () => {
    const env = envFor()
    const req = new Request('https://x/api/profiles/alice')
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.status).toBe(404)
  })

  it('404 when the user is deleted', async () => {
    const env = envFor()
    seedUser(env.state, { deleted_at: Date.now() })
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    const req = new Request('https://x/api/profiles/alice')
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.status).toBe(404)
  })

  it('returns empty shares array when handle exists but no profile-listed shares', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    env.state.published_shares.push({
      id: 'unl1',
      user_id: 'user-1',
      title: 'Hidden',
      visibility: 'unlisted',
      expires_at: null,
      version: 1,
      published_at: 100,
      republished_at: null,
      revoked_at: null,
    })
    const req = new Request('https://x/api/profiles/alice')
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      handle: string
      name: string | null
      avatar_url: string | null
      shares: unknown[]
    }
    expect(body.handle).toBe('alice')
    expect(body.name).toBe('Alice')
    expect(body.avatar_url).toBe('https://x/a.png')
    expect(body.shares).toEqual([])
  })

  it('returns only profile-listed, non-revoked, non-expired shares ordered by published_at DESC', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    const now = Date.now()
    env.state.published_shares.push(
      // profile-listed, older
      {
        id: 'older',
        user_id: 'user-1',
        title: 'Older',
        visibility: 'profile-listed',
        expires_at: null,
        version: 1,
        published_at: 100,
        republished_at: null,
        revoked_at: null,
      },
      // profile-listed, newer
      {
        id: 'newer',
        user_id: 'user-1',
        title: 'Newer',
        visibility: 'profile-listed',
        expires_at: null,
        version: 2,
        published_at: 300,
        republished_at: null,
        revoked_at: null,
      },
      // unlisted — must be excluded
      {
        id: 'unlisted',
        user_id: 'user-1',
        title: 'U',
        visibility: 'unlisted',
        expires_at: null,
        version: 1,
        published_at: 250,
        republished_at: null,
        revoked_at: null,
      },
      // revoked — must be excluded
      {
        id: 'revoked',
        user_id: 'user-1',
        title: 'R',
        visibility: 'profile-listed',
        expires_at: null,
        version: 1,
        published_at: 200,
        republished_at: null,
        revoked_at: now,
      },
      // expired — must be excluded
      {
        id: 'expired',
        user_id: 'user-1',
        title: 'E',
        visibility: 'profile-listed',
        expires_at: now - 1000,
        version: 1,
        published_at: 220,
        republished_at: null,
        revoked_at: null,
      },
      // someone else's share — must be excluded
      {
        id: 'other',
        user_id: 'other-user',
        title: 'O',
        visibility: 'profile-listed',
        expires_at: null,
        version: 1,
        published_at: 400,
        republished_at: null,
        revoked_at: null,
      },
    )
    const req = new Request('https://x/api/profiles/alice')
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { shares: Array<{ id: string }> }
    expect(body.shares.map((s) => s.id)).toEqual(['newer', 'older'])
  })

  it('429 when the per-IP profile cap is exceeded', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    // Mirror PROFILE_RATE_{WINDOW_SEC,MAX} from profiles/[handle].ts.
    const RATE_WINDOW_SEC = 60
    const RATE_MAX = 120
    const slot = Math.floor(Date.now() / 1000 / RATE_WINDOW_SEC)
    await env.RATE.put(`rate/profile/1.2.3.4/${slot}`, String(RATE_MAX), {
      expirationTtl: RATE_WINDOW_SEC * 2,
    })
    const req = new Request('https://x/api/profiles/alice', {
      headers: { 'CF-Connecting-IP': '1.2.3.4' },
    })
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.status).toBe(429)
  })

  it('sets cache-control: public, max-age=30, must-revalidate', async () => {
    const env = envFor()
    seedUser(env.state)
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    const req = new Request('https://x/api/profiles/alice')
    const res = await invoke(profileGet, req, env, { handle: 'alice' })
    expect(res.headers.get('cache-control')).toBe('public, max-age=30, must-revalidate')
  })
})

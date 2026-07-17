import { describe, expect, it } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'

import { onRequestPatch as visibilityPatch } from '../functions/api/me/shares/[id]'
import type { SessionRecord } from '../src/auth/session'
import { nanoidSlug } from '../src/publish/slug'

import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, type FakeDbState } from './_helpers/fakes'

const TOKEN = 'v'.repeat(40)

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

function seedShare(
  state: FakeDbState,
  overrides: Partial<FakeDbState['published_shares'][number]> = {},
): FakeDbState['published_shares'][number] {
  const row = {
    id: nanoidSlug(),
    user_id: 'user-1',
    title: 'A nice chat',
    visibility: 'unlisted',
    expires_at: null,
    version: 1,
    published_at: Date.now(),
    republished_at: null,
    revoked_at: null,
    draft_id: null,
    client_request_id: null,
    ...overrides,
  }
  state.published_shares.push(row)
  return row
}

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  return {
    DB: db,
    SESSIONS: makeKv(),
    META: makeKv(),
    RATE: makeKv(),
    state: s,
  }
}

function patchReq(id: string, body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'CF-Connecting-IP': '1.2.3.4',
  }
  if (token) headers['authorization'] = `Bearer ${token}`
  return new Request(`https://spool.pro/api/me/shares/${id}`, {
    method: 'PATCH',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

async function setup(over: Parameters<typeof seedShare>[1] = {}, withHandle = true) {
  const state = emptyState()
  seedUser(state)
  if (withHandle) {
    state.handles.push({ handle: 'alice', user_id: 'user-1', claimed_at: Date.now(), released_at: null })
  }
  const share = seedShare(state, over)
  const env = envFor(state)
  await seedSession(env.SESSIONS, TOKEN, 'user-1')
  return { env, share }
}

describe('PATCH /api/me/shares/:id (visibility)', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const { env, share } = await setup()
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }, null), env, { id: share.id })
    expect(res.status).toBe(401)
  })

  it("404s another user's share without leaking its existence", async () => {
    const { env, share } = await setup({ user_id: 'user-2' })
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(404)
    expect(share.visibility).toBe('unlisted')
  })

  it('404s an invalid slug before touching auth or DB', async () => {
    const { env } = await setup()
    const res = await invoke(visibilityPatch, patchReq('!bad slug!', { visibility: 'unlisted' }), env, { id: '!bad slug!' })
    expect(res.status).toBe(404)
  })

  it('410s a revoked share — tombstones are immutable', async () => {
    const { env, share } = await setup({ revoked_at: Date.now() - 1000 })
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(410)
    expect(share.visibility).toBe('unlisted')
  })

  it('422s an unknown visibility value', async () => {
    const { env, share } = await setup()
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'public' }), env, { id: share.id })
    expect(res.status).toBe(422)
  })

  it('400s malformed json', async () => {
    const { env, share } = await setup()
    const res = await invoke(visibilityPatch, patchReq(share.id, '{not json'), env, { id: share.id })
    expect(res.status).toBe(400)
  })

  it('422s profile-listed when the user has no live handle — same gate as publish', async () => {
    const { env, share } = await setup({}, /* withHandle */ false)
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(422)
    expect(share.visibility).toBe('unlisted')
  })

  it('allows unlisting even without a handle', async () => {
    const { env, share } = await setup({ visibility: 'profile-listed' }, /* withHandle */ false)
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'unlisted' }), env, { id: share.id })
    expect(res.status).toBe(200)
    expect(share.visibility).toBe('unlisted')
  })

  it('lists a share: updates D1, the KV meta sidecar, and writes an audit row', async () => {
    const { env, share } = await setup()
    await env.META.put(`meta/${share.id}`, JSON.stringify({
      owner: 'user-1',
      title: share.title,
      visibility: 'unlisted',
      expires_at: null,
      revoked_at: null,
      version: 1,
    }))

    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, visibility: 'profile-listed' })

    expect(share.visibility).toBe('profile-listed')
    const meta = JSON.parse((await env.META.get(`meta/${share.id}`)) as string)
    expect(meta.visibility).toBe('profile-listed')
    // Untouched meta fields survive the read-modify-write.
    expect(meta.title).toBe(share.title)
    expect(meta.version).toBe(1)

    const auditRow = env.state.audit.find((a) => a.action === 'share.visibility')
    expect(auditRow).toBeTruthy()
    expect(auditRow?.target_id).toBe(share.id)
  })

  it('no-ops idempotently when the visibility already matches', async () => {
    const { env, share } = await setup({ visibility: 'profile-listed' })
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, visibility: 'profile-listed' })
    // No audit row for a no-op.
    expect(env.state.audit.some((a) => a.action === 'share.visibility')).toBe(false)
  })

  it('survives a missing KV meta row (D1 stays the source of truth)', async () => {
    const { env, share } = await setup()
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(200)
    expect(share.visibility).toBe('profile-listed')
  })

  it("UPDATE is scoped to user_id: a passing ownership SELECT still can't mutate another user's row", async () => {
    // Defense-in-depth for the UPDATE itself. The ownership SELECT 404s a
    // cross-user share today, so this forces the SELECT to pass (as a
    // future refactor or a bug might) and asserts the WHERE id=? AND
    // user_id=? clause keeps the victim's row untouched. On the pre-fix
    // `WHERE id=?` UPDATE this mutates user-2's share and the test fails.
    const state = emptyState()
    seedUser(state, 'user-1')
    seedUser(state, 'user-2')
    state.handles.push({ handle: 'alice', user_id: 'user-1', claimed_at: Date.now(), released_at: null })
    // Victim row belongs to user-2.
    const victim = seedShare(state, { user_id: 'user-2', visibility: 'unlisted' })
    const env = envFor(state)
    await seedSession(env.SESSIONS, TOKEN, 'user-1')

    // Force the ownership SELECT to report success for the attacker
    // (user-1) even though the row is user-2's. Every other prepared
    // statement (the UPDATE included) runs against the real fake DB.
    const realPrepare = env.DB.prepare.bind(env.DB)
    const intercept = (sql: string) => {
      if (/^SELECT visibility, revoked_at FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
        return {
          bind: () => ({ first: async () => ({ visibility: 'unlisted', revoked_at: null }) }),
        } as unknown as ReturnType<typeof realPrepare>
      }
      return realPrepare(sql)
    }
    ;(env.DB as unknown as { prepare: typeof realPrepare }).prepare =
      intercept as unknown as typeof realPrepare

    const res = await invoke(visibilityPatch, patchReq(victim.id, { visibility: 'profile-listed' }), env, { id: victim.id })
    expect(res.status).toBe(200)
    // The UPDATE's user_id=? clause matched no row for user-1, so the
    // victim's visibility is unchanged.
    expect(victim.visibility).toBe('unlisted')
  })

  it('429s past the hourly per-user cap', async () => {
    const { env, share } = await setup()
    for (let i = 0; i < 60; i++) {
      const flip = i % 2 === 0 ? 'profile-listed' : 'unlisted'
      const r = await invoke(visibilityPatch, patchReq(share.id, { visibility: flip }), env, { id: share.id })
      expect(r.status).toBe(200)
    }
    const res = await invoke(visibilityPatch, patchReq(share.id, { visibility: 'profile-listed' }), env, { id: share.id })
    expect(res.status).toBe(429)
  })
})

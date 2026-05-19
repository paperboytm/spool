import { describe, expect, it } from 'vitest'

import { nanoidSlug } from '../src/publish/slug'

import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  const snapshots = makeR2()
  const og = makeR2()
  return {
    DB: db,
    META: makeKv(),
    SNAPSHOTS: snapshots.bucket,
    OG: og.bucket,
    state: s,
    _snapshots: snapshots.store,
    _og: og.store,
  }
}

function seedUser(state: FakeDbState, id: string): void {
  state.users.push({
    id,
    google_sub: `g-${id}`,
    email: `${id}@example.com`,
    name: id,
    avatar_url: `https://example.com/${id}.png`,
    created_at: Date.now(),
    last_signin_at: Date.now(),
    deletion_pending_until: null,
    deleted_at: null,
  })
}

async function seedShareWithAssets(
  env: ReturnType<typeof envFor>,
  user_id: string,
  slug: string,
): Promise<void> {
  env.state.published_shares.push({
    id: slug,
    user_id,
    title: 'A chat',
    visibility: 'unlisted',
    expires_at: null,
    version: 1,
    published_at: Date.now(),
    republished_at: null,
    revoked_at: null,
  })
  await env.SNAPSHOTS.put(`${slug}.json`, JSON.stringify({ id: slug }))
  await env.OG.put(`${slug}.png`, new Uint8Array([1, 2, 3]).buffer)
  await env.META.put(
    `meta/${slug}`,
    JSON.stringify({ owner: user_id, visibility: 'unlisted', expires_at: null, revoked_at: null, version: 1 }),
  )
}

describe('runDeletionSweep', () => {
  it('purges a due user: R2 snapshots + OG cleared, handle released, user soft-deleted, queue row removed', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    env.state.handles.push({
      handle: 'alice',
      user_id: 'user-1',
      claimed_at: Date.now(),
      released_at: null,
    })
    const slug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', slug)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    // R2 cleared
    expect(env._snapshots.has(`${slug}.json`)).toBe(false)
    expect(env._og.has(`${slug}.png`)).toBe(false)
    // KV meta replaced with tombstone
    const metaRaw = await env.META.get(`meta/${slug}`)
    expect(metaRaw).not.toBeNull()
    const meta = JSON.parse(metaRaw!) as { revoked_at: number | null; version: number }
    expect(typeof meta.revoked_at).toBe('number')
    expect(meta.version).toBe(0)
    // D1 share marked revoked
    expect(env.state.published_shares.find((s) => s.id === slug)?.revoked_at).toBeTruthy()
    // handle released
    expect(env.state.handles.find((h) => h.handle === 'alice')?.released_at).toBeTruthy()
    // user soft-deleted
    const user = env.state.users.find((u) => u.id === 'user-1')!
    expect(user.email).toBe('[deleted]')
    expect(user.name).toBeNull()
    expect(user.avatar_url).toBeNull()
    expect(typeof user.deleted_at).toBe('number')
    // queue row gone
    expect(env.state.deletion_queue.find((r) => r.user_id === 'user-1')).toBeUndefined()
  })

  it('leaves cancelled rows alone', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const slug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', slug)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 1,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(env._snapshots.has(`${slug}.json`)).toBe(true)
    expect(env._og.has(`${slug}.png`)).toBe(true)
    expect(env.state.published_shares.find((s) => s.id === slug)?.revoked_at).toBeNull()
    expect(env.state.users.find((u) => u.id === 'user-1')?.deleted_at).toBeNull()
    // cancelled row stays (we don't sweep cancelled ones — user may un-cancel?).
    expect(env.state.deletion_queue.find((r) => r.user_id === 'user-1')?.cancelled).toBe(1)
  })

  it('leaves future-scheduled rows untouched', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const slug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', slug)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() + 60_000,
      cancelled: 0,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(env._snapshots.has(`${slug}.json`)).toBe(true)
    expect(env.state.users.find((u) => u.id === 'user-1')?.deleted_at).toBeNull()
    expect(env.state.deletion_queue.length).toBe(1)
  })

  it('processes multiple due users in one sweep', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'user-2')
    const a = nanoidSlug()
    const b = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', a)
    await seedShareWithAssets(env, 'user-2', b)
    env.state.deletion_queue.push(
      { user_id: 'user-1', scheduled_at: Date.now() - 1000, cancelled: 0 },
      { user_id: 'user-2', scheduled_at: Date.now() - 500, cancelled: 0 },
    )

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(env._snapshots.size).toBe(0)
    expect(env._og.size).toBe(0)
    expect(env.state.users.every((u) => u.deleted_at !== null)).toBe(true)
    expect(env.state.deletion_queue.length).toBe(0)
  })
})

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
    email: `${id}@example.com`,
    name: id,
    avatar_url: `https://example.com/${id}.png`,
    created_at: Date.now(),
    last_signin_at: Date.now(),
    deletion_pending_until: null,
    deleted_at: null,
  })
  // Mirror the user_identities link that upsertUserByIdentity would
  // have written at sign-in time, so deletion sees something to drop.
  state.user_identities.push({
    provider: 'google',
    provider_sub: `g-${id}`,
    user_id: id,
    email: `${id}@example.com`,
    linked_at: Date.now(),
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
    // user soft-deleted: PII fields cleared. The "you can sign back in"
    // guarantee is that user_identities lost every row for this user
    // (the JOIN in upsertUserByIdentity misses, fresh row created).
    const user = env.state.users.find((u) => u.id === 'user-1')!
    expect(user.email).toBe('[deleted]')
    expect(user.name).toBeNull()
    expect(user.avatar_url).toBeNull()
    expect(typeof user.deleted_at).toBe('number')
    // identity links dropped — re-sign-in with the same Google account
    // misses the JOIN in upsertUserByIdentity and creates a fresh user.
    expect(env.state.user_identities.filter((i) => i.user_id === 'user-1')).toEqual([])
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

  it('in-loop cancel re-check skips a user whose row flipped to cancelled between SELECTs', async () => {
    // Outer SELECT picks up user-1 + user-2 (both due). Before the
    // per-user loop processes user-1, we flip its queue row to
    // cancelled=1 — simulating a real-world POST DELETE /api/me/delete
    // landing inside the cron's processing window. The inner re-check
    // must catch it and skip; user-2 must still be processed.
    const env = envFor()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'user-2')
    const a = nanoidSlug()
    const b = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', a)
    await seedShareWithAssets(env, 'user-2', b)
    env.state.deletion_queue.push(
      { user_id: 'user-1', scheduled_at: Date.now() - 1000, cancelled: 0 },
      { user_id: 'user-2', scheduled_at: Date.now() - 1000, cancelled: 0 },
    )

    // Intercept the inner-loop SELECT so user-1's check returns null
    // (as if cancelled landed) while user-2's check returns truthy.
    const realPrepare = env.DB.prepare.bind(env.DB)
    const intercept = (sql: string) => {
      const stmt = realPrepare(sql)
      if (/^SELECT 1 FROM deletion_queue WHERE user_id=\? AND cancelled=0/i.test(sql)) {
        return {
          bind: (uid: string) => ({
            first: async () => (uid === 'user-1' ? null : ({ '1': 1 })),
          }),
        } as unknown as ReturnType<typeof realPrepare>
      }
      return stmt
    }
    ;(env.DB as unknown as { prepare: typeof realPrepare }).prepare =
      intercept as unknown as typeof realPrepare

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    // user-1 untouched
    expect(env._snapshots.has(`${a}.json`)).toBe(true)
    expect(env.state.users.find((u) => u.id === 'user-1')?.deleted_at).toBeNull()
    // user-2 processed
    expect(env._snapshots.has(`${b}.json`)).toBe(false)
    expect(env.state.users.find((u) => u.id === 'user-2')?.deleted_at).toBeTruthy()
  })

  it('is idempotent: re-running the sweep on already-processed state is a no-op', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const slug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', slug)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())
    const userSnapshot = JSON.stringify(env.state.users)
    const sharesSnapshot = JSON.stringify(env.state.published_shares)
    const queueSnapshot = JSON.stringify(env.state.deletion_queue)

    // Second sweep — queue row is gone so the user-deletion branch is a
    // no-op; the orphan branch may re-issue idempotent R2 deletes but
    // mutates nothing observable.
    await runDeletionSweep(env, Date.now())
    expect(JSON.stringify(env.state.users)).toBe(userSnapshot)
    expect(JSON.stringify(env.state.published_shares)).toBe(sharesSnapshot)
    expect(JSON.stringify(env.state.deletion_queue)).toBe(queueSnapshot)
  })

  it('isolates per-user failures: one bad row does not block the rest', async () => {
    // Make the share-listing SELECT throw the first time it runs (for
    // user-1) and succeed thereafter (for user-2). The outer try/catch
    // should swallow user-1's failure and let user-2 complete.
    const env = envFor()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'user-2')
    const b = nanoidSlug()
    await seedShareWithAssets(env, 'user-2', b)
    env.state.deletion_queue.push(
      { user_id: 'user-1', scheduled_at: Date.now() - 2000, cancelled: 0 },
      { user_id: 'user-2', scheduled_at: Date.now() - 1000, cancelled: 0 },
    )

    const realPrepare = env.DB.prepare.bind(env.DB)
    const intercept = (sql: string) => {
      const stmt = realPrepare(sql)
      if (/^SELECT id FROM published_shares WHERE user_id=\?$/i.test(sql)) {
        return {
          bind: (uid: string) => ({
            all: async () => {
              if (uid === 'user-1') throw new Error('synthetic D1 failure')
              return stmt.bind(uid).all()
            },
          }),
        } as unknown as ReturnType<typeof realPrepare>
      }
      return stmt
    }
    ;(env.DB as unknown as { prepare: typeof realPrepare }).prepare =
      intercept as unknown as typeof realPrepare

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    // user-1 stuck (queue row still there, account not deleted)
    expect(env.state.users.find((u) => u.id === 'user-1')?.deleted_at).toBeNull()
    // user-2 cleaned through
    expect(env._snapshots.has(`${b}.json`)).toBe(false)
    expect(env.state.users.find((u) => u.id === 'user-2')?.deleted_at).toBeTruthy()
  })

  it('orphan sweep: cleans R2 for revoked-but-not-cleaned and recently-expired shares', async () => {
    // Bulk publish three shares that bypassed the revoke/expire R2
    // cleanup (waitUntil failure / silent expiration). The orphan
    // branch must reap their R2 assets without touching the still-
    // active share.
    const env = envFor()
    seedUser(env.state, 'user-1')
    const now = Date.now()
    const revokedSlug = nanoidSlug()
    const expiredSlug = nanoidSlug()
    const activeSlug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', revokedSlug)
    await seedShareWithAssets(env, 'user-1', expiredSlug)
    await seedShareWithAssets(env, 'user-1', activeSlug)
    const revokedRow = env.state.published_shares.find((s) => s.id === revokedSlug)!
    revokedRow.revoked_at = now - 1000 // recent revoke, R2 not cleaned
    const expiredRow = env.state.published_shares.find((s) => s.id === expiredSlug)!
    expiredRow.expires_at = now - 1000 // expired just now, R2 still there

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, now)

    expect(env._snapshots.has(`${revokedSlug}.json`)).toBe(false)
    expect(env._og.has(`${revokedSlug}.png`)).toBe(false)
    expect(env._snapshots.has(`${expiredSlug}.json`)).toBe(false)
    expect(env._og.has(`${expiredSlug}.png`)).toBe(false)
    // Active share untouched.
    expect(env._snapshots.has(`${activeSlug}.json`)).toBe(true)
    expect(env._og.has(`${activeSlug}.png`)).toBe(true)
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

import { describe, expect, it } from 'vite-plus/test'

import { nanoidSlug } from '../src/publish/slug'
import { emptyState, makeDb, makeKv, makeR2, type FakeDbState } from './_helpers/fakes'

function envFor(state?: FakeDbState) {
  const { db, state: s } = makeDb(state ?? emptyState())
  const snapshots = makeR2()
  const og = makeR2()
  const avatars = makeR2()
  const hub = makeR2()
  return {
    DB: db,
    META: makeKv(),
    SNAPSHOTS: snapshots.bucket,
    OG: og.bucket,
    AVATARS: avatars.bucket,
    HUB: hub.bucket,
    state: s,
    _snapshots: snapshots.store,
    _og: og.store,
    _avatars: avatars.store,
    _hub: hub.store,
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
    // Every user seeded in this suite has already confirmed account
    // deletion. The production worker refuses to claim a queue row unless
    // this current-state marker is still present.
    deletion_pending_until: Date.now() - 1,
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
    JSON.stringify({
      owner: user_id,
      visibility: 'unlisted',
      expires_at: null,
      revoked_at: null,
      version: 1,
    }),
  )
}

async function seedHubData(
  env: ReturnType<typeof envFor>,
  options: {
    userId: string
    sid: string
    root: string
    packKey: string
    oids: string[]
  },
): Promise<void> {
  const now = Date.now()
  env.state.hub_sessions.push({
    sid: options.sid,
    owner_user_id: options.userId,
    root: options.root,
    record_count: options.oids.length,
    sig: null,
    card_json: null,
    note_md: null,
    lineage_json: null,
    view_oid: options.oids[0] ?? null,
    spool_file_oid: null,
    cost_usd: null,
    total_tokens: null,
    visibility: 'unlisted',
    withdrawn_at: null,
    created_at: now,
    updated_at: now,
  })
  for (const [index, oid] of options.oids.entries()) {
    env.state.hub_objects.push({
      owner_user_id: options.userId,
      oid,
      size: 1,
      pack_key: options.packKey,
      offset: index,
      length: 1,
      created_at: now,
    })
  }
  await env.HUB.put(options.packKey, new Uint8Array(options.oids.length).buffer)
}

describe('runDeletionSweep', () => {
  it('re-checks live Team ownership and safely cancels before destructive work', async () => {
    const env = envFor()
    seedUser(env.state, 'user-owner')
    env.state.users[0]!.deletion_pending_until = Date.now() - 1
    env.state.teams.push({
      id: 'team-owned',
      name: 'Owned Team',
      workos_organization_id: 'org_owned',
      archived_at: null,
    })
    env.state.team_memberships.push({
      team_id: 'team-owned',
      user_id: 'user-owner',
      role: 'owner',
      workos_membership_id: 'om_owner',
    })
    env.state.deletion_queue.push({
      user_id: 'user-owner',
      scheduled_at: Date.now() - 1_000,
      cancelled: 0,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(env.state.deletion_queue[0]?.cancelled).toBe(1)
    expect(env.state.users[0]).toMatchObject({
      email: 'user-owner@example.com',
      deleted_at: null,
      deletion_pending_until: null,
    })
    expect(env.state.team_memberships).toHaveLength(1)
    expect(env.state.workos_cleanup_outbox).toEqual([])
  })

  it('atomically enqueues every external membership before deleting the local account', async () => {
    const env = envFor()
    seedUser(env.state, 'user-member')
    env.state.teams.push({
      id: 'team-member',
      name: 'Member Team',
      workos_organization_id: 'org_member',
      archived_at: null,
    })
    env.state.team_memberships.push({
      team_id: 'team-member',
      user_id: 'user-member',
      role: 'member',
      workos_membership_id: 'om_member',
    })
    env.state.deletion_queue.push({
      user_id: 'user-member',
      scheduled_at: Date.now() - 1_000,
      cancelled: 0,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(env.state.team_memberships).toEqual([])
    expect(env.state.workos_cleanup_outbox).toEqual([
      expect.objectContaining({
        operation: 'membership.delete',
        resource_id: 'om_member',
        team_id: 'team-member',
        user_id: 'user-member',
      }),
    ])
  })

  it('purges a due user with no Hub data and removes the queue row', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    env.state.api_tokens.push({
      id: 'token-1',
      user_id: 'user-1',
      token_hash: 'hash-1',
      label: 'CLI',
      created_at: Date.now(),
      last_used_at: null,
    })
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
    // expires_at was removed with the expiry feature (#385/#386); the
    // tombstone must not resurrect the dead field.
    expect('expires_at' in meta).toBe(false)
    // D1 share marked revoked
    expect(env.state.published_shares.find((s) => s.id === slug)?.revoked_at).toBeTruthy()
    // handle released
    expect(env.state.handles.find((h) => h.handle === 'alice')?.released_at).toBeTruthy()
    // user soft-deleted: PII fields cleared. The "you can sign back in"
    // guarantee is that user_identities lost every row for this user
    // — the JOIN in upsertUserByIdentity misses and a fresh users row
    // is created on next sign-in.
    const user = env.state.users.find((u) => u.id === 'user-1')!
    expect(user.email).toBe('[deleted]')
    expect(user.name).toBeNull()
    expect(user.avatar_url).toBeNull()
    expect(typeof user.deleted_at).toBe('number')
    // identity links dropped — re-sign-in with the same Google account
    // misses the JOIN in upsertUserByIdentity and creates a fresh user.
    expect(env.state.user_identities.filter((i) => i.user_id === 'user-1')).toEqual([])
    expect(env.state.api_tokens.filter((token) => token.user_id === 'user-1')).toEqual([])
    expect(env.state.hub_sessions).toEqual([])
    expect(env.state.hub_objects).toEqual([])
    expect(env._hub.size).toBe(0)
    // queue row gone
    expect(env.state.deletion_queue.find((r) => r.user_id === 'user-1')).toBeUndefined()
  })

  it('withdraws every Hub Session before deleting each distinct owner pack and its D1 rows', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    seedUser(env.state, 'user-2')
    const sharedPack = 'hub/packs/user-1/shared-pack'
    const secondPack = 'hub/packs/user-1/second-pack'
    const orphanPack = 'hub/packs/user-1/orphan-pack'
    const siblingPack = 'hub/packs/user-2/keep-pack'
    await seedHubData(env, {
      userId: 'user-1',
      sid: 'codex_due-a',
      root: 'root-a',
      packKey: sharedPack,
      oids: ['oid-a', 'oid-b'],
    })
    await seedHubData(env, {
      userId: 'user-1',
      sid: 'codex_due-b',
      root: 'root-b',
      packKey: sharedPack,
      oids: ['oid-c'],
    })
    await seedHubData(env, {
      userId: 'user-1',
      sid: 'codex_due-c',
      root: 'root-c',
      packKey: secondPack,
      oids: ['oid-d'],
    })
    await seedHubData(env, {
      userId: 'user-2',
      sid: 'codex_keep',
      // Manifests are globally content-addressed, so another owner can
      // legitimately reference the same root as a due user.
      root: 'root-a',
      packKey: siblingPack,
      oids: ['oid-a', 'oid-b'],
    })
    // Simulates writePack succeeding before insertObjects fails: there is
    // no hub_objects row from which DISTINCT pack_key could discover it.
    await env.HUB.put(orphanPack, new Uint8Array([9]).buffer)
    await env.HUB.put('hub/manifests/root-a', 'oid-a\noid-b\n')
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })

    const deletedHubKeys: string[] = []
    let failClosedAtPhysicalDelete = false
    const realHubDelete = env.HUB.delete.bind(env.HUB)
    ;(
      env.HUB as unknown as {
        delete(keys: string | string[]): Promise<void>
      }
    ).delete = async (keys) => {
      const batch = Array.isArray(keys) ? keys : [keys]
      deletedHubKeys.push(...batch)
      failClosedAtPhysicalDelete = env.state.hub_sessions
        .filter((session) => session.owner_user_id === 'user-1')
        .every((session) => session.withdrawn_at !== null)
      await realHubDelete(keys)
    }

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    expect(failClosedAtPhysicalDelete).toBe(true)
    expect([...deletedHubKeys].sort()).toEqual([orphanPack, secondPack, sharedPack])
    expect(env._hub.has(sharedPack)).toBe(false)
    expect(env._hub.has(secondPack)).toBe(false)
    expect(env._hub.has(orphanPack)).toBe(false)
    expect(env._hub.has(siblingPack)).toBe(true)
    expect(env._hub.has('hub/manifests/root-a')).toBe(true)
    expect(env.state.hub_objects.every((row) => row.owner_user_id === 'user-2')).toBe(true)
    expect(env.state.hub_sessions.map((session) => session.sid)).toEqual(['codex_keep'])
    expect(env.state.deletion_queue).toEqual([])
  })

  it('keeps Hub Sessions withdrawn and queued when the orphan-prefix list fails, then finishes on retry', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const packKey = 'hub/packs/user-1/retry-pack'
    const orphanPack = 'hub/packs/user-1/retry-orphan-pack'
    await seedHubData(env, {
      userId: 'user-1',
      sid: 'codex_retry-r2',
      root: 'root-retry-r2',
      packKey,
      oids: ['oid-retry-r2'],
    })
    await env.HUB.put(orphanPack, new Uint8Array([9]).buffer)
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })

    const realHubList = env.HUB.list.bind(env.HUB)
    let failOnce = true
    ;(env.HUB as unknown as { list: typeof env.HUB.list }).list = async (options) => {
      if (failOnce) {
        failOnce = false
        throw new Error('synthetic Hub R2 list failure')
      }
      return realHubList(options)
    }

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    const { requireReadableSession } = await import('../src/hub/head')
    await runDeletionSweep(env, Date.now())

    expect(env.state.hub_sessions[0]?.withdrawn_at).not.toBeNull()
    await expect(requireReadableSession(env.DB, 'codex_retry-r2')).rejects.toMatchObject({
      code: 'GONE',
    })
    expect(env.state.hub_objects).toHaveLength(1)
    expect(env._hub.has(packKey)).toBe(false)
    expect(env._hub.has(orphanPack)).toBe(true)
    expect(env.state.deletion_queue).toHaveLength(1)
    expect(env.state.users[0]?.deleted_at).toBeNull()

    // A failed processor keeps its lease so another cron cannot race its
    // external cleanup. Once that lease expires, the next sweep resumes.
    await runDeletionSweep(env, Date.now() + 31 * 60 * 1000)

    expect(env._hub.has(packKey)).toBe(false)
    expect(env._hub.has(orphanPack)).toBe(false)
    expect(env.state.hub_objects).toEqual([])
    expect(env.state.hub_sessions).toEqual([])
    expect(env.state.deletion_queue).toEqual([])
    expect(env.state.users[0]?.deleted_at).not.toBeNull()
  })

  it('retries safely after a partial Hub D1 cleanup failure', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const packKey = 'hub/packs/user-1/retry-d1-pack'
    await seedHubData(env, {
      userId: 'user-1',
      sid: 'codex_retry-d1',
      root: 'root-retry-d1',
      packKey,
      oids: ['oid-retry-d1'],
    })
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })

    const realPrepare = env.DB.prepare.bind(env.DB)
    let failOnce = true
    const intercept = (sql: string) => {
      const stmt = realPrepare(sql)
      if (/^DELETE FROM hub_sessions WHERE owner_user_id=\? AND team_id IS NULL$/i.test(sql)) {
        return {
          bind: (userId: string) => ({
            run: async () => {
              if (failOnce) {
                failOnce = false
                throw new Error('synthetic Hub D1 failure')
              }
              return stmt.bind(userId).run()
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

    // D1 rolls the two row deletions back together. The physical pack is
    // already gone, but the withdrawn Session and queue row keep the state
    // fail-closed; retrying the idempotent R2 delete then commits both rows.
    expect(env._hub.has(packKey)).toBe(false)
    expect(env.state.hub_objects).toHaveLength(1)
    expect(env.state.hub_sessions[0]?.withdrawn_at).not.toBeNull()
    expect(env.state.deletion_queue).toHaveLength(1)

    await runDeletionSweep(env, Date.now() + 31 * 60 * 1000)

    expect(env.state.hub_sessions).toEqual([])
    expect(env.state.deletion_queue).toEqual([])
    expect(env.state.users[0]?.deleted_at).not.toBeNull()
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

  it('does not steal a live processing lease and resumes it only after expiry', async () => {
    const env = envFor()
    seedUser(env.state, 'user-1')
    const slug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', slug)
    const now = Date.now()
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: now - 1_000,
      cancelled: 0,
      state: 'processing',
      processing_token: 'delete_original',
      processing_lease_until: now + 60_000,
    })

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, now)

    expect(env._snapshots.has(`${slug}.json`)).toBe(true)
    expect(env.state.deletion_queue[0]?.processing_token).toBe('delete_original')
    expect(env.state.users[0]?.deleted_at).toBeNull()

    await runDeletionSweep(env, now + 60_001)

    expect(env._snapshots.has(`${slug}.json`)).toBe(false)
    expect(env.state.deletion_queue).toEqual([])
    expect(env.state.users[0]?.deleted_at).not.toBeNull()
  })

  it('does not delete when cancellation wins the atomic processing claim', async () => {
    // Outer SELECT picks up user-1 + user-2. Simulate cancellation winning
    // immediately before user-1's guarded UPDATE claim; user-2 must still
    // be processed normally.
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

    const realPrepare = env.DB.prepare.bind(env.DB)
    const intercept = (sql: string) => {
      const stmt = realPrepare(sql)
      if (sql.includes('/* account-deletion:claim */')) {
        const bound: unknown[] = []
        return {
          bind: (...params: unknown[]) => {
            bound.push(...params)
            return {
              run: async () => {
                const uid = bound[2] as string
                if (uid === 'user-1') {
                  const queue = env.state.deletion_queue.find((row) => row.user_id === uid)!
                  queue.cancelled = 1
                  queue.state = 'cancelled'
                  return { success: true, meta: { changes: 0 } }
                }
                return stmt.bind(...bound).run()
              },
            }
          },
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

  it('orphan sweep: cleans R2 for revoked-but-not-cleaned shares, leaves live ones (incl. legacy expiry rows)', async () => {
    // A revoked share that bypassed the revoke R2 cleanup (waitUntil
    // failure) must be reaped. A live share with a stale legacy
    // expires_at must NOT be — the expiry feature was removed and old
    // values are dead data.
    const env = envFor()
    seedUser(env.state, 'user-1')
    const now = Date.now()
    const revokedSlug = nanoidSlug()
    const legacyExpirySlug = nanoidSlug()
    const activeSlug = nanoidSlug()
    await seedShareWithAssets(env, 'user-1', revokedSlug)
    await seedShareWithAssets(env, 'user-1', legacyExpirySlug)
    await seedShareWithAssets(env, 'user-1', activeSlug)
    const revokedRow = env.state.published_shares.find((s) => s.id === revokedSlug)!
    revokedRow.revoked_at = now - 1000 // recent revoke, R2 not cleaned
    const legacyRow = env.state.published_shares.find((s) => s.id === legacyExpirySlug)!
    legacyRow.expires_at = now - 1000 // stale legacy value — not a tombstone

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, now)

    expect(env._snapshots.has(`${revokedSlug}.json`)).toBe(false)
    expect(env._og.has(`${revokedSlug}.png`)).toBe(false)
    // Live shares untouched — including the legacy-expiry one.
    expect(env._snapshots.has(`${legacyExpirySlug}.json`)).toBe(true)
    expect(env._og.has(`${legacyExpirySlug}.png`)).toBe(true)
    expect(env._snapshots.has(`${activeSlug}.json`)).toBe(true)
    expect(env._og.has(`${activeSlug}.png`)).toBe(true)
  })

  it('avatar sweep: pages through R2 list until truncated=false (1001 objects)', async () => {
    // R2's list endpoint caps at 1000 results per call. Without the
    // cursor loop in deleteAvatarPrefix the 1001st object would survive
    // the user's hard-delete — a privacy bug for the "I uploaded a
    // selfie and then deleted my account" case.
    const env = envFor()
    seedUser(env.state, 'user-1')
    env.state.deletion_queue.push({
      user_id: 'user-1',
      scheduled_at: Date.now() - 1000,
      cancelled: 0,
    })
    for (let i = 0; i < 1001; i++) {
      await env.AVATARS.put(
        `avatars/user-1/${String(i).padStart(4, '0')}.png`,
        new Uint8Array([0]).buffer,
      )
    }
    // A sibling key under a different prefix must NOT be touched.
    await env.AVATARS.put('avatars/user-2/keep.png', new Uint8Array([0]).buffer)

    const { runDeletionSweep } = await import('../functions/_scheduled/deletion-worker')
    await runDeletionSweep(env, Date.now())

    const survivors = Array.from(env._avatars.keys())
    expect(survivors).toEqual(['avatars/user-2/keep.png'])
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

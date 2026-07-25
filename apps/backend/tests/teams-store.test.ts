import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import {
  archiveLocalTeam,
  createLocalInvitation,
  failTeamCreationRequest,
  failTeamInvitationCreationRequest,
  insertInvitationProjection,
  getTeamForMember,
  listTeamsForUser,
  listTeamInvitations,
  listTeamMembers,
  memberPermissions,
  removeLocalMembership,
  reconcileInvitationProjections,
  syncLocalMembership,
  transferTeamOwnership,
} from '../src/teams/store'
import { syncWorkosMemberships } from '../src/teams/sync'
import { permissionsForRole, type TeamInvitationRow, type TeamRow } from '../src/teams/types'

type Prepared = {
  sql: string
  params: unknown[]
  bind: (...params: unknown[]) => Prepared
  first: <T>() => Promise<T | null>
  all: <T>() => Promise<{ results: T[] }>
  run: () => Promise<{ meta: { changes: number } }>
}

function fakeDb(
  firstFor: (sql: string, params: readonly unknown[]) => unknown = () => null,
  changesFor: (sql: string) => number = () => 1,
  allFor: (sql: string, params: readonly unknown[]) => unknown[] = () => [],
): {
  db: D1Database
  batches: Prepared[][]
  prepared: Prepared[]
} {
  const batches: Prepared[][] = []
  const prepared: Prepared[] = []
  const db = {
    prepare(sql: string): Prepared {
      const statement: Prepared = {
        sql,
        params: [],
        bind(...params: unknown[]) {
          statement.params = params
          return statement
        },
        async first<T>() {
          return (firstFor(sql, statement.params) as T | null) ?? null
        },
        async all<T>() {
          return { results: allFor(sql, statement.params) as T[] }
        },
        async run() {
          return { meta: { changes: changesFor(sql) } }
        },
      }
      prepared.push(statement)
      return statement
    },
    async batch(statements: D1PreparedStatement[]) {
      const rows = statements as unknown as Prepared[]
      batches.push(rows)
      return rows.map((statement) => ({ meta: { changes: changesFor(statement.sql) } }))
    },
  } as unknown as D1Database
  return { db, batches, prepared }
}

const TEAM: TeamRow = {
  id: 'team_00000000000000000000000000000000',
  workos_organization_id: 'org_1',
  name: 'Team',
  created_by_user_id: 'local_owner',
  created_at: 1,
  updated_at: 1,
  deletion_pending_until: null,
  archived_at: null,
}

afterEach(() => {
  vi.restoreAllMocks()
})

function invitation(createdAt: number): TeamInvitationRow {
  return {
    id: 'tinv_00000000000000000000000000000000',
    workos_invitation_id: 'invitation_1',
    team_id: TEAM.id,
    email: 'member@example.com',
    desired_role: 'admin',
    status: 'accepted',
    invited_by_user_id: 'local_owner',
    accepted_workos_user_id: 'workos_user_original',
    expires_at: null,
    accepted_at: null,
    revoked_at: null,
    created_at: createdAt,
    updated_at: createdAt,
  }
}

describe('Team permissions', () => {
  it('grants Session management to owner/admin but not member', () => {
    expect(permissionsForRole('owner')).toContain('sessions:manage')
    expect(permissionsForRole('admin')).toContain('sessions:manage')
    expect(permissionsForRole('member')).not.toContain('sessions:manage')
  })

  it('computes member-row capabilities from both actor and target', () => {
    const owner = {
      team_id: TEAM.id,
      user_id: 'owner_1',
      role: 'owner' as const,
      workos_membership_id: 'membership_owner',
      joined_at: 1,
      updated_at: 1,
    }
    const admin = { ...owner, user_id: 'admin_1', role: 'admin' as const }
    const member = { ...owner, user_id: 'member_1', role: 'member' as const }
    const otherOwner = { ...owner, user_id: 'owner_2' }

    expect(memberPermissions(owner, owner, 1)).toEqual([])
    expect(memberPermissions(owner, member, 1)).toEqual([
      'role:update',
      'remove',
      'ownership:transfer',
    ])
    expect(memberPermissions(owner, otherOwner, 2)).toEqual(['role:update', 'remove'])
    expect(memberPermissions(admin, member, 1)).toEqual(['role:update', 'remove'])
    expect(memberPermissions(admin, owner, 1)).toEqual([])
    expect(memberPermissions(member, admin, 1)).toEqual([])
  })

  it('omits leave from the sole owner Team summary returned by list', async () => {
    const row = {
      ...TEAM,
      role: 'owner' as const,
      member_count: 3,
      owner_count: 1,
    }
    const { db } = fakeDb(
      () => null,
      () => 1,
      (sql) => (sql.includes('/* teams:list */') ? [row] : []),
    )

    const [team] = await listTeamsForUser(db, TEAM.created_by_user_id)

    expect(team?.permissions).not.toContain('team:leave')
    expect(team?.permissions).toContain('team:archive')
  })

  it('includes leave for an owner when Team summary observes another owner', async () => {
    const { db } = fakeDb((sql) =>
      sql.includes('/* teams:get-for-member */')
        ? {
            ...TEAM,
            role: 'owner' as const,
            member_count: 3,
            owner_count: 2,
          }
        : null,
    )

    const team = await getTeamForMember(db, TEAM.id, TEAM.created_by_user_id)

    expect(team?.permissions).toContain('team:leave')
  })

  it('transfers ownership by updating the old and new owner in one statement', async () => {
    const { db, prepared } = fakeDb(
      () => null,
      (sql) => (sql.includes('/* teams:transfer-ownership */') ? 2 : 1),
    )
    await expect(transferTeamOwnership(db, TEAM.id, 'owner_1', 'member_1', 300)).resolves.toBe(true)
    const statement = prepared.find((row) => row.sql.includes('/* teams:transfer-ownership */'))
    expect(statement?.sql).toContain("THEN 'owner' ELSE 'admin'")
    expect(statement?.sql).toContain("actor.role='owner'")
    expect(statement?.params).toEqual([
      'member_1',
      300,
      TEAM.id,
      'owner_1',
      'member_1',
      'owner_1',
      'member_1',
      TEAM.id,
      'owner_1',
      TEAM.id,
      'member_1',
      'member_1',
    ])
  })

  it('returns actor-scoped row permissions and a user-keyed custom avatar URL', async () => {
    const owner = {
      team_id: TEAM.id,
      user_id: 'owner_1',
      role: 'owner' as const,
      workos_membership_id: 'membership_owner',
      joined_at: 1,
      updated_at: 1,
    }
    const { db } = fakeDb(
      (sql) => (sql.includes('/* teams:count-owners */') ? { count: 1 } : null),
      () => 1,
      (sql) =>
        sql.includes('/* teams:list-members */')
          ? [
              {
                ...owner,
                email: 'owner@example.com',
                name: 'Owner',
                display_name: null,
                avatar_url: null,
                custom_avatar_id: null,
                avatar_visible: 1,
              },
              {
                ...owner,
                user_id: 'member_1',
                role: 'member',
                email: 'member@example.com',
                name: 'Member',
                display_name: null,
                avatar_url: null,
                custom_avatar_id: 'avatar_hash',
                avatar_visible: 1,
              },
            ]
          : [],
    )
    const members = await listTeamMembers(db, TEAM.id, owner)
    expect(members[0]?.permissions).toEqual([])
    expect(members[1]).toMatchObject({
      user_id: 'member_1',
      avatar_url: '/api/avatars/member_1?v=avatar_hash',
      permissions: ['role:update', 'remove', 'ownership:transfer'],
    })
  })
})

describe('Team membership removal tombstones', () => {
  it('stores both the local and WorkOS user ids in the block', async () => {
    const { db, batches } = fakeDb((sql) =>
      sql.includes('/* teams:workos-user-for-block */')
        ? { provider_sub: 'workos_user_original' }
        : null,
    )
    await removeLocalMembership(
      db,
      TEAM.id,
      'local_user_original',
      'local_owner',
      'om_original',
      500,
    )

    expect(batches).toHaveLength(1)
    const block = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:block-membership */'),
    )
    expect(block?.params).toEqual([
      TEAM.id,
      'local_user_original',
      'workos_user_original',
      500,
      'local_owner',
      TEAM.id,
      'local_user_original',
    ])
  })

  it('reports a protected last-owner delete as unchanged and gates its tombstone insert', async () => {
    const { db, batches } = fakeDb(
      (sql) =>
        sql.includes('/* teams:workos-user-for-block */') ? { provider_sub: 'workos_owner' } : null,
      (sql) => (sql.includes('/* teams:remove-membership */') ? 0 : 1),
    )
    await expect(
      removeLocalMembership(db, TEAM.id, 'local_owner', 'local_owner', 'om_owner', 500),
    ).resolves.toBe(false)
    const remove = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:remove-membership */'),
    )
    const block = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:block-membership */'),
    )
    expect(remove?.sql).toContain("other_owner.role='owner'")
    expect(block?.sql).toContain('WHERE NOT EXISTS (SELECT 1 FROM team_memberships')
  })

  it('does not revive the same WorkOS identity under a new local user id', async () => {
    const { db, batches, prepared } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return { blocked_at: 100 }
      if (sql.includes('/* teams:sync-invitation */')) return null
      return null
    })
    await syncLocalMembership(db, {
      userId: 'local_user_new',
      email: 'member@example.com',
      team: TEAM,
      membership: {
        id: 'membership_1',
        user_id: 'workos_user_original',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })

    const lookup = prepared.find((statement) => statement.sql.includes('/* teams:get-block */'))
    expect(lookup?.params).toEqual([TEAM.id, 'local_user_new', 'workos_user_original'])
    expect(batches).toHaveLength(0)
  })

  it('allows a newer explicit invitation to supersede and clear either block key', async () => {
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return { blocked_at: 100 }
      if (sql.includes('/* teams:sync-invitation */')) return invitation(150)
      if (sql.includes('/* teams:get-membership */')) return null
      return null
    })
    await syncLocalMembership(db, {
      userId: 'local_user_new',
      email: 'member@example.com',
      team: TEAM,
      membership: {
        id: 'membership_2',
        user_id: 'workos_user_original',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })

    expect(batches).toHaveLength(1)
    expect(
      batches[0]!.find((statement) => statement.sql.includes('/* teams:sync-membership */'))
        ?.params[2],
    ).toBe('admin')
    const clear = batches[0]!.find((statement) => statement.sql.includes('/* teams:clear-block */'))
    expect(clear?.params).toEqual([
      TEAM.id,
      'local_user_new',
      'workos_user_original',
      'local_user_new',
      TEAM.id,
      'local_user_new',
      'membership_2',
      invitation(150).id,
      TEAM.id,
      'workos_user_original',
    ])
  })

  it('does not let a pending reinvite revive a stale upstream membership', async () => {
    const pending = {
      ...invitation(150),
      status: 'pending' as const,
      accepted_workos_user_id: null,
    }
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return { blocked_at: 100 }
      if (sql.includes('/* teams:sync-invitation */')) return pending
      return null
    })
    await syncLocalMembership(db, {
      userId: 'local_user_new',
      email: 'member@example.com',
      team: TEAM,
      membership: {
        id: 'stale_membership',
        user_id: 'workos_user_original',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })
    expect(batches).toHaveLength(0)
  })

  it('retains desired role when a domain invitation is accepted under another email', async () => {
    const accepted = {
      ...invitation(150),
      email: 'invited@company.example',
    }
    const { db, batches, prepared } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return null
      if (sql.includes('/* teams:sync-invitation */')) return accepted
      if (sql.includes('/* teams:get-membership */')) return null
      return null
    })
    await syncLocalMembership(db, {
      userId: 'local_user_new',
      email: 'accepted@company.example',
      team: TEAM,
      membership: {
        id: 'membership_accepted',
        user_id: 'workos_user_original',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })
    const lookup = prepared.find((statement) =>
      statement.sql.includes('/* teams:sync-invitation */'),
    )
    expect(lookup?.params).toEqual([
      TEAM.id,
      'workos_user_original',
      'accepted@company.example',
      'workos_user_original',
    ])
    expect(
      batches[0]!.find((statement) => statement.sql.includes('/* teams:sync-membership */'))
        ?.params[2],
    ).toBe('admin')
  })

  it('does not grant an accepted invite role when only a recycled email matches', async () => {
    const acceptedForSomeoneElse = {
      ...invitation(150),
      accepted_workos_user_id: 'workos_user_someone_else',
    }
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return null
      if (sql.includes('/* teams:sync-invitation */')) return acceptedForSomeoneElse
      if (sql.includes('/* teams:get-membership */')) return null
      return null
    })
    await syncLocalMembership(db, {
      userId: 'local_user_new',
      email: 'member@example.com',
      team: TEAM,
      membership: {
        id: 'membership_recycled_email',
        user_id: 'workos_user_original',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })
    expect(
      batches[0]!.find((statement) => statement.sql.includes('/* teams:sync-membership */'))
        ?.params[2],
    ).toBe('member')
    expect(
      batches[0]!.some((statement) => statement.sql.includes('/* teams:accept-invitation */')),
    ).toBe(false)
  })

  it('rechecks exact membership denials and removal blocks in the final sync statement', async () => {
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-block */')) return null
      if (sql.includes('/* teams:sync-invitation */')) return null
      if (sql.includes('/* teams:get-membership */')) return null
      return null
    })

    await syncLocalMembership(db, {
      userId: 'local_user_racing',
      email: 'racing@example.com',
      team: TEAM,
      membership: {
        id: 'membership_stale_snapshot',
        user_id: 'workos_user_racing',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
      },
      now: 200,
    })

    const sync = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:sync-membership */'),
    )
    expect(sync?.sql).toContain('workos_membership_denials')
    expect(sync?.sql).toContain('workos_user_denials')
    expect(sync?.sql).toContain('team_membership_blocks')
    expect(sync?.sql).toContain('FROM users live_user')
    expect(sync?.sql).toContain('live_user.deletion_pending_until IS NULL')
    expect(sync?.sql).toContain("accepted.status='accepted'")
    expect(sync?.sql).toMatch(
      /WHERE \(\s+EXISTS \([\s\S]+\)\s+AND EXISTS \([\s\S]+FROM users live_user/,
    )
    expect(sync?.params).toContain('membership_stale_snapshot')
  })

  it('keeps sign-in sync from restoring membership while account deletion is pending', async () => {
    const deniedAt = Date.parse('2026-07-22T00:00:00.000Z')
    const activeAt = Date.parse('2026-07-22T00:01:00.000Z')
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-membership-denial */')) {
        return { reason: 'inactive', workos_updated_at: deniedAt, previous_role: 'owner' }
      }
      return null
    })

    await syncLocalMembership(db, {
      userId: 'deletion_pending_owner',
      email: 'owner@example.com',
      team: TEAM,
      membership: {
        id: 'membership_reactivated_during_deletion',
        user_id: 'workos_deletion_pending_owner',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
        updated_at: new Date(activeAt).toISOString(),
      },
      now: activeAt,
    })

    const sync = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:sync-membership */'),
    )
    const denialClear = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:clear-superseded-membership-denial */'),
    )
    expect(sync?.sql).toContain(
      'live_user.deleted_at IS NULL\n             AND live_user.deletion_pending_until IS NULL',
    )
    expect(sync?.params).toContain('deletion_pending_owner')
    expect(denialClear?.sql).toContain('FROM users live_user')
    expect(denialClear?.params).toContain('deletion_pending_owner')
  })

  it('restores the prior role only when an active snapshot is newer than an inactive denial', async () => {
    const deniedAt = Date.parse('2026-07-22T00:00:00.000Z')
    const activeAt = Date.parse('2026-07-22T00:01:00.000Z')
    const { db, batches } = fakeDb((sql) => {
      if (sql.includes('/* teams:get-membership-denial */')) {
        return { reason: 'inactive', workos_updated_at: deniedAt, previous_role: 'owner' }
      }
      if (sql.includes('/* teams:get-block */')) return null
      if (sql.includes('/* teams:sync-invitation */')) return null
      if (sql.includes('/* teams:get-membership */')) return null
      return null
    })

    await syncLocalMembership(db, {
      userId: 'local_owner_returning',
      email: 'owner@example.com',
      team: TEAM,
      membership: {
        id: 'membership_reactivated',
        user_id: 'workos_owner_returning',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
        updated_at: new Date(activeAt).toISOString(),
      },
      now: activeAt,
    })

    const sync = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:sync-membership */'),
    )
    expect(sync?.params[2]).toBe('owner')
    expect(sync?.sql).toContain("denied.reason='inactive'")
    expect(
      batches[0]!.some((statement) =>
        statement.sql.includes('/* teams:clear-superseded-membership-denial */'),
      ),
    ).toBe(true)
  })

  it('fails closed when an active snapshot is not newer than its exact denial', async () => {
    const version = Date.parse('2026-07-22T00:00:00.000Z')
    const { db, batches } = fakeDb((sql) =>
      sql.includes('/* teams:get-membership-denial */')
        ? { reason: 'inactive', workos_updated_at: version, previous_role: 'admin' }
        : null,
    )

    await syncLocalMembership(db, {
      userId: 'local_admin_stale',
      email: 'admin@example.com',
      team: TEAM,
      membership: {
        id: 'membership_stale',
        user_id: 'workos_admin_stale',
        organization_id: TEAM.workos_organization_id,
        status: 'active',
        updated_at: new Date(version).toISOString(),
      },
      now: version + 1,
    })

    expect(batches).toHaveLength(0)
  })

  it('atomically reapplies an accepted exact invitation role to an already-synced member', async () => {
    const { db, batches } = fakeDb()
    const accepted = invitation(150)
    const inserted = await createLocalInvitation(db, {
      id: accepted.id,
      teamId: TEAM.id,
      email: accepted.email,
      desiredRole: 'admin',
      invitedByUserId: 'local_owner',
      idempotencyKey: 'invite-lost-response-0001',
      invitation: {
        id: accepted.workos_invitation_id,
        email: accepted.email,
        state: 'accepted',
        organization_id: TEAM.workos_organization_id,
        accepted_user_id: accepted.accepted_workos_user_id,
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:01:00.000Z',
      },
      now: 200,
    })

    expect(inserted).toBe(true)
    const create = batches[0]!.find((statement) =>
      statement.sql.includes('/* teams:create-invitation */'),
    )
    expect(create?.sql).toContain("?='accepted'")
    expect(create?.sql).toContain("identity.provider='workos'")
    expect(
      batches[0]!.some((statement) =>
        statement.sql.includes('/* teams:apply-accepted-invitation-role */'),
      ),
    ).toBe(true)
  })
})

describe('WorkOS sign-in membership sync', () => {
  it('skips invitation history when the local membership already exists', async () => {
    const existing = {
      team_id: TEAM.id,
      user_id: 'local_member',
      role: 'admin' as const,
      workos_membership_id: 'membership_known',
      workos_updated_at: 1,
      joined_at: 1,
      updated_at: 1,
    }
    const { db } = fakeDb(
      (sql) => {
        if (sql.includes('/* teams:get-by-workos-org */')) return TEAM
        if (sql.includes('/* teams:get-membership */')) return existing
        return null
      },
      () => 1,
      (sql) =>
        sql.includes('/* teams:local-workos-memberships */')
          ? [
              {
                workos_membership_id: 'membership_known',
                workos_organization_id: TEAM.workos_organization_id,
              },
            ]
          : [],
    )
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'membership_known',
              user_id: 'workos_member',
              organization_id: TEAM.workos_organization_id,
              status: 'active',
              updated_at: '2026-07-22T00:00:00.000Z',
            },
          ],
          list_metadata: {},
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    )

    await syncWorkosMemberships(
      db,
      { WORKOS_API_KEY: 'sk_test' },
      {
        localUserId: 'local_member',
        workosUserId: 'workos_member',
        email: 'member@example.com',
      },
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/invitations?'))).toBe(
      false,
    )
  })

  it('aligns by organization and applies a WorkOS-identity block to a new local account', async () => {
    const { db, batches, prepared } = fakeDb((sql, params) => {
      if (sql.includes('/* teams:get-by-workos-org */')) {
        return params[0] === TEAM.workos_organization_id ? TEAM : null
      }
      if (sql.includes('/* teams:get-block */')) return { blocked_at: 100 }
      if (sql.includes('/* teams:sync-invitation */')) return null
      return null
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/user_management/organization_memberships?')) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'membership_known',
                user_id: 'workos_user_original',
                organization_id: TEAM.workos_organization_id,
                status: 'active',
              },
              {
                id: 'membership_unknown',
                user_id: 'workos_user_original',
                organization_id: 'org_not_managed_by_spool',
                status: 'active',
              },
            ],
            list_metadata: {},
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/user_management/invitations?')) {
        return new Response(JSON.stringify({ data: [], list_metadata: {} }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    await syncWorkosMemberships(
      db,
      { WORKOS_API_KEY: 'sk_test' },
      {
        localUserId: 'local_user_new',
        workosUserId: 'workos_user_original',
        email: 'MEMBER@EXAMPLE.COM',
      },
    )

    const blockLookup = prepared.find((statement) =>
      statement.sql.includes('/* teams:get-block */'),
    )
    expect(blockLookup?.params).toEqual([TEAM.id, 'local_user_new', 'workos_user_original'])
    expect(batches).toHaveLength(0)
    expect(fetchSpy.mock.calls.some(([input]) => String(input).includes('/invitations?'))).toBe(
      true,
    )
  })

  it('paginates every local membership before fail-closed absent reconciliation', async () => {
    const local = Array.from({ length: 501 }, (_, index) => ({
      workos_membership_id: `om_${String(index).padStart(4, '0')}`,
      workos_organization_id: `org_${index}`,
    }))
    const { db, batches, prepared } = fakeDb(
      () => null,
      () => 1,
      (sql, params) => {
        if (!sql.includes('/* teams:local-workos-memberships */')) return []
        const [, after, limit] = params as [string, string, number]
        return local.filter((membership) => membership.workos_membership_id > after).slice(0, limit)
      },
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      String(input).includes('?')
        ? new Response(JSON.stringify({ data: [], list_metadata: {} }), {
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ message: 'not found' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          }),
    )

    await syncWorkosMemberships(
      db,
      { WORKOS_API_KEY: 'sk_test' },
      {
        localUserId: 'local_user_many_teams',
        workosUserId: 'workos_user_many_teams',
        email: 'many@example.com',
      },
    )

    expect(
      prepared.filter((statement) =>
        statement.sql.includes('/* teams:local-workos-memberships */'),
      ),
    ).toHaveLength(2)
    expect(batches).toHaveLength(501)
  })

  it('confirms an active-list absence before choosing reversible inactive deprovisioning', async () => {
    const local = {
      workos_membership_id: 'om_inactive_before_webhook',
      workos_organization_id: TEAM.workos_organization_id,
    }
    const { db, batches } = fakeDb(
      () => null,
      () => 1,
      (sql) => (sql.includes('/* teams:local-workos-memberships */') ? [local] : []),
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('?')) {
        return new Response(JSON.stringify({ data: [], list_metadata: {} }), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response(
        JSON.stringify({
          id: local.workos_membership_id,
          user_id: 'workos_user_original',
          organization_id: TEAM.workos_organization_id,
          status: 'inactive',
          updated_at: '2026-07-22T00:00:00.000Z',
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    })

    await syncWorkosMemberships(
      db,
      { WORKOS_API_KEY: 'sk_test' },
      {
        localUserId: 'local_user_original',
        workosUserId: 'workos_user_original',
        email: 'member@example.com',
      },
    )

    const denial = batches[0]!.find((statement) =>
      statement.sql.includes('/* workos-webhook:deny-membership */'),
    )
    expect(denial?.params).toContain('inactive')
    const block = batches[0]!.find((statement) =>
      statement.sql.includes('/* workos-webhook:block-membership */'),
    )
    expect(block?.params).toContain(1)
  })
})

describe('Team archive disclosure boundary', () => {
  it('archives, privatizes Sessions, and removes discovery rows in one D1 batch', async () => {
    const { db, batches } = fakeDb()
    await expect(archiveLocalTeam(db, TEAM.id, 'local_owner', 900)).resolves.toBe(true)

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(6)
    expect(batches[0]!.map((statement) => statement.sql)).toEqual([
      expect.stringContaining('/* teams:archive */'),
      expect.stringContaining('/* teams:archive-sessions */'),
      expect.stringContaining('/* teams:archive-discovery-engagement */'),
      expect.stringContaining('/* teams:archive-session-stars */'),
      expect.stringContaining('/* teams:archive-discovery */'),
      expect.stringContaining('/* teams:archive-workos-cleanup */'),
    ])
    expect(batches[0]![1]!.sql).toContain("visibility='private'")
    expect(batches[0]![2]!.sql).toContain('hub_session_engagement_daily')
    expect(batches[0]![3]!.sql).toContain('hub_session_stars')
    expect(batches[0]![4]!.sql).toContain('hub_session_discovery')
  })
})

describe('Team bounded SaaS invariants', () => {
  it('checks deletion_pending again inside the ownership transfer UPDATE', async () => {
    const { db, prepared } = fakeDb()
    await transferTeamOwnership(db, TEAM.id, 'owner_1', 'member_1', 1)
    expect(prepared[0]?.sql).toContain('target_user.deletion_pending_until IS NULL')
  })

  it('bounds member and invitation response queries', async () => {
    const { db, prepared } = fakeDb((sql) =>
      sql.includes('/* teams:count-owners */') ? { count: 1 } : null,
    )
    await listTeamMembers(db, TEAM.id, {
      team_id: TEAM.id,
      user_id: 'owner_1',
      role: 'owner',
      workos_membership_id: 'om_owner',
      joined_at: 1,
      updated_at: 1,
    })
    await listTeamInvitations(db, TEAM.id)
    expect(prepared.find((item) => item.sql.includes('/* teams:list-members */'))?.sql).toContain(
      'LIMIT ?',
    )
    expect(
      prepared.find((item) => item.sql.includes('/* teams:list-invitations */'))?.sql,
    ).toContain('LIMIT ?')
  })

  it('enforces active members plus pending invitations in the final INSERT', async () => {
    const { db, prepared } = fakeDb()
    await insertInvitationProjection(db, {
      id: 'tinv_00000000000000000000000000000001',
      teamId: TEAM.id,
      email: 'new@example.com',
      desiredRole: 'member',
      invitedByUserId: 'owner_1',
      invitation: {
        id: 'inv_1',
        email: 'new@example.com',
        state: 'pending',
        organization_id: TEAM.workos_organization_id,
        accepted_user_id: null,
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:00:00.000Z',
      },
    })
    const insert = prepared.find((item) => item.sql.includes('/* teams:insert-invitation */'))
    expect(insert?.sql).toContain('SELECT COUNT(*) FROM team_memberships')
    expect(insert?.sql).toContain("status='pending'")
    expect(insert?.params).toContain(500)
  })

  it('atomically records terminal creation failures with their cleanup outbox rows', async () => {
    const { db, batches } = fakeDb()
    await expect(failTeamCreationRequest(db, 'owner_1', 'create-key-0000001', 10)).resolves.toBe(
      true,
    )
    await expect(
      failTeamInvitationCreationRequest(db, {
        teamId: TEAM.id,
        invitedByUserId: 'owner_1',
        idempotencyKey: 'invite-key-0000001',
        now: 11,
      }),
    ).resolves.toBe(true)

    expect(batches[0]!.map((statement) => statement.sql)).toEqual([
      expect.stringContaining('/* teams:fail-creation-enqueue-cleanup */'),
      expect.stringContaining('/* teams:fail-creation-request */'),
    ])
    expect(batches[1]!.map((statement) => statement.sql)).toEqual([
      expect.stringContaining('/* teams:fail-invitation-enqueue-cleanup */'),
      expect.stringContaining('/* teams:fail-invitation-creation-request */'),
    ])
    expect(batches[0]![1]!.sql).toContain("cleanup.operation='organization.delete'")
    expect(batches[1]![1]!.sql).toContain("cleanup.operation='invitation.revoke'")
  })

  it('recovers an accepted pre-projection invite from the ledger before role sync', async () => {
    const { db, batches } = fakeDb(
      () => null,
      () => 1,
      (sql) =>
        sql.includes('/* teams:list-pending-invitation-creation-requests */')
          ? [
              {
                team_id: TEAM.id,
                invited_by_user_id: 'owner_1',
                idempotency_key: 'invite-key-0000002',
                invitation_id: 'tinv_00000000000000000000000000000002',
                normalized_email: 'admin@example.com',
                desired_role: 'admin',
                status: 'pending',
                workos_invitation_id: 'inv_accepted',
                created_at: 1,
                updated_at: 1,
              },
            ]
          : [],
    )
    await reconcileInvitationProjections(db, TEAM.id, [
      {
        id: 'inv_accepted',
        email: 'admin@example.com',
        state: 'accepted',
        organization_id: TEAM.workos_organization_id,
        accepted_user_id: 'workos_admin',
        accepted_at: '2026-07-22T00:01:00.000Z',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:01:00.000Z',
      },
    ])

    const recovery = batches
      .flat()
      .find((statement) =>
        statement.sql.includes('/* teams:recover-invitation-creation-projection */'),
      )
    expect(recovery?.sql).toContain('request.desired_role')
    expect(recovery?.params).toContain('accepted')
    expect(recovery?.params).toContain('workos_admin')
    expect(
      batches
        .flat()
        .some((statement) =>
          statement.sql.includes('/* teams:complete-recovered-invitation-creation */'),
        ),
    ).toBe(true)
  })

  it('does not adopt a historic same-email invitation without an exact recorded id', async () => {
    const { db, batches } = fakeDb(
      () => null,
      () => 1,
      (sql) =>
        sql.includes('/* teams:list-pending-invitation-creation-requests */')
          ? [
              {
                team_id: TEAM.id,
                invited_by_user_id: 'owner_1',
                idempotency_key: 'invite-key-0000003',
                invitation_id: 'tinv_00000000000000000000000000000003',
                normalized_email: 'member@example.com',
                desired_role: 'member',
                status: 'pending',
                workos_invitation_id: null,
                created_at: 1,
                updated_at: 1,
              },
            ]
          : [],
    )

    await reconcileInvitationProjections(db, TEAM.id, [
      {
        id: 'historic_accepted_invitation',
        email: 'member@example.com',
        state: 'accepted',
        organization_id: TEAM.workos_organization_id,
        accepted_user_id: 'workos_existing_member',
        created_at: '2026-07-22T00:00:00.000Z',
        updated_at: '2026-07-22T00:01:00.000Z',
      },
    ])

    expect(
      batches
        .flat()
        .some((statement) =>
          statement.sql.includes('/* teams:recover-invitation-creation-projection */'),
        ),
    ).toBe(false)
  })
})

import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  listOwnerHubSessions,
  listTeamHubSessions,
  parseManagedHubSessionPageOptions,
  type ManagedHubSession,
} from '../src/hub/management'
import type { HubSessionRow } from '../src/hub/store'

const TEAM_SESSION: HubSessionRow = {
  sid: 'claude_11111111-1111-4111-8111-111111111111',
  owner_user_id: 'author_1',
  root: 'root',
  record_count: 2,
  sig: null,
  card_json: JSON.stringify({ title: 'Team planning' }),
  note_md: 'Shared notes',
  lineage_json: null,
  view_oid: 'view',
  spool_file_oid: null,
  cost_usd: null,
  total_tokens: null,
  visibility: 'private',
  team_id: 'team_1',
  withdrawn_at: null,
  created_at: 1,
  updated_at: 2,
}

function mockDatabase(feedRows: unknown[]) {
  const sqlLog: string[] = []
  const bindLog: unknown[][] = []
  const prepare = vi.fn((sql: string) => {
    sqlLog.push(sql)
    return {
      bind: vi.fn((...args: unknown[]) => {
        bindLog.push(args)
        return {
          all: vi.fn(async () => ({ results: feedRows })),
          first: vi.fn(async () => {
            if (sql.includes('SELECT name, avatar_url')) {
              return {
                name: 'Author',
                avatar_url: null,
                display_name: 'Author',
                custom_avatar_id: null,
                avatar_visible: 1,
              }
            }
            if (sql.includes('SELECT handle FROM handles')) return { handle: 'author' }
            return null
          }),
        }
      }),
    }
  })
  return { db: { prepare } as unknown as D1Database, sqlLog, bindLog }
}

describe('Team Session management feed', () => {
  it('authorizes membership, active user, and active Team in the same deterministic query', async () => {
    const unauthorized = mockDatabase([])
    await expect(listTeamHubSessions(unauthorized.db, 'team_1', 'user_1')).resolves.toBeNull()

    const sql = unauthorized.sqlLog[0] ?? ''
    expect(sql).toContain('JOIN team_memberships m')
    expect(sql).toContain('JOIN users actor')
    expect(sql).toContain('m.user_id=?')
    expect(sql).toContain('actor.deleted_at IS NULL')
    expect(sql).toContain('actor.deletion_pending_until IS NULL')
    expect(sql).toContain('t.archived_at IS NULL')
    expect(sql).toContain('t.deletion_pending_until IS NULL')
    expect(sql).toContain('ON s.team_id=current_team.id AND s.withdrawn_at IS NULL')
    expect(sql).toContain('s.updated_at<?')
    expect(sql).toContain('ORDER BY s.updated_at DESC, s.sid ASC')
    expect(unauthorized.bindLog[0]).toEqual(['team_1', 'user_1', 0, 0, 0, '', 51])
  })

  it('distinguishes an authorized empty Team from an unavailable Team', async () => {
    const authorized = mockDatabase([{ sid: null, team_name: 'Paperboy', team_role: 'member' }])

    await expect(listTeamHubSessions(authorized.db, 'team_1', 'user_1')).resolves.toEqual({
      sessions: [],
      next_cursor: null,
    })
  })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
  ] as const)(
    'derives %s visibility management from the same feed snapshot',
    async (role, canManage) => {
      const authorized = mockDatabase([{ ...TEAM_SESSION, team_name: 'Paperboy', team_role: role }])

      const page = await listTeamHubSessions(authorized.db, 'team_1', 'user_1')
      const sessions = page?.sessions as ManagedHubSession[]
      expect(sessions).toHaveLength(1)
      expect(sessions[0]).toMatchObject({
        sid: TEAM_SESSION.sid,
        team_id: 'team_1',
        team_name: 'Paperboy',
        can_manage_visibility: canManage,
      })
    },
  )

  it('returns both canonical task titles so Mine and Team feeds can localize them', async () => {
    const authorized = mockDatabase([
      {
        ...TEAM_SESSION,
        note_md:
          '---\ntitle: Ship Team workspaces\ntitle_zh: 交付团队工作区\n---\n\n## Outcome\n\nDone.',
        team_name: 'Paperboy',
        team_role: 'member',
      },
    ])

    const page = await listTeamHubSessions(authorized.db, 'team_1', 'user_1')

    expect(page?.sessions[0]).toMatchObject({
      title: 'Ship Team workspaces',
      titles: { en: 'Ship Team workspaces', zh: '交付团队工作区' },
      summary: '## Outcome\n\nDone.',
    })
  })

  it('hides Sessions from archived or deletion-pending Teams in the owner feed', async () => {
    const owner = mockDatabase([])

    await expect(listOwnerHubSessions(owner.db, 'user_1')).resolves.toEqual({
      sessions: [],
      next_cursor: null,
    })

    const sql = owner.sqlLog[0] ?? ''
    expect(sql).toContain('FROM users actor')
    expect(sql).toContain('actor.deletion_pending_until IS NULL')
    expect(sql).toContain('t.archived_at IS NULL')
    expect(sql).toContain('t.deletion_pending_until IS NULL')
    expect(sql).toContain('ORDER BY s.updated_at DESC, s.sid ASC')
  })

  it('paginates by updated_at DESC and sid ASC without silently truncating the feed', async () => {
    const firstSid = 'claude_11111111-1111-4111-8111-111111111111'
    const secondSid = 'claude_22222222-2222-4222-8222-222222222222'
    const first = mockDatabase([
      { ...TEAM_SESSION, sid: firstSid, team_id: null, updated_at: 20, team_name: null },
      { ...TEAM_SESSION, sid: secondSid, team_id: null, updated_at: 20, team_name: null },
    ])

    const firstPage = await listOwnerHubSessions(first.db, 'user_1', {
      cursor: null,
      limit: 1,
    })

    expect(firstPage.sessions.map((session) => session.sid)).toEqual([firstSid])
    expect(firstPage.next_cursor).toEqual(expect.any(String))
    expect(first.bindLog[0]).toEqual(['user_1', 0, 0, 0, '', 2])

    const next = mockDatabase([])
    await expect(
      listOwnerHubSessions(next.db, 'user_1', {
        cursor: firstPage.next_cursor,
        limit: 1,
      }),
    ).resolves.toEqual({ sessions: [], next_cursor: null })
    expect(next.bindLog[0]).toEqual(['user_1', 1, 20, 20, firstSid, 2])
  })

  it('binds every cursor to the feed scope and current actor', async () => {
    const first = mockDatabase([
      { ...TEAM_SESSION, team_id: null, team_name: null },
      {
        ...TEAM_SESSION,
        sid: 'claude_22222222-2222-4222-8222-222222222222',
        team_id: null,
        team_name: null,
      },
    ])
    const page = await listOwnerHubSessions(first.db, 'user_1', { cursor: null, limit: 1 })

    await expect(
      listOwnerHubSessions(mockDatabase([]).db, 'user_2', {
        cursor: page.next_cursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(
      listTeamHubSessions(mockDatabase([]).db, 'team_1', 'user_1', {
        cursor: page.next_cursor,
        limit: 1,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('keeps an authorized Team distinguishable when a later page is empty', async () => {
    const first = mockDatabase([
      { ...TEAM_SESSION, team_name: 'Paperboy', team_role: 'member' },
      {
        ...TEAM_SESSION,
        sid: 'claude_22222222-2222-4222-8222-222222222222',
        team_name: 'Paperboy',
        team_role: 'member',
      },
    ])
    const page = await listTeamHubSessions(first.db, 'team_1', 'user_1', {
      cursor: null,
      limit: 1,
    })
    const later = mockDatabase([{ sid: null, team_name: 'Paperboy', team_role: 'member' }])

    await expect(
      listTeamHubSessions(later.db, 'team_1', 'user_1', {
        cursor: page?.next_cursor ?? null,
        limit: 1,
      }),
    ).resolves.toEqual({ sessions: [], next_cursor: null })
  })

  it('validates page size and duplicate query parameters', () => {
    expect(
      parseManagedHubSessionPageOptions(new Request('https://spool.new/api/me/sessions')),
    ).toEqual({ cursor: null, limit: 50 })
    expect(
      parseManagedHubSessionPageOptions(
        new Request('https://spool.new/api/me/sessions?limit=50&cursor=opaque'),
      ),
    ).toEqual({ cursor: 'opaque', limit: 50 })
    expect(() =>
      parseManagedHubSessionPageOptions(new Request('https://spool.new/api/me/sessions?limit=0')),
    ).toThrow(/limit must be an integer/)
    expect(() =>
      parseManagedHubSessionPageOptions(
        new Request('https://spool.new/api/me/sessions?cursor=a&cursor=b'),
      ),
    ).toThrow(/cursor must be provided at most once/)
  })
})

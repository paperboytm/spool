import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { D1Database } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vite-plus/test'

import { onRequestGet as meStarredProjectsGet } from '../functions/api/me/starred-projects'
import { onRequestPut as projectStarPut } from '../functions/api/owners/[handle]/projects/[slug]/star'
import { finishSocialListPage, parseSocialListOptions } from '../src/social/limits'
import {
  getProjectSocialState,
  listProjectStargazers,
  listStarredProjectsForOwner,
  listStarredProjectsForUser,
  resolveProjectSocialTarget,
  starProject,
  watchProject,
} from '../src/social/projects'
import { followUser, getUserFollowState, resolveUserFollowTarget } from '../src/social/users'
import { invoke } from './_helpers/ctx'
import { makeKv } from './_helpers/fakes'

type Script = {
  all?: unknown[][]
  first?: unknown[]
  run?: Array<{ changes?: number }>
}

function scriptedDb(script: Script): {
  calls: Array<{ params: unknown[]; sql: string }>
  db: D1Database
} {
  const calls: Array<{ params: unknown[]; sql: string }> = []
  const first = [...(script.first ?? [])]
  const all = [...(script.all ?? [])]
  const run = [...(script.run ?? [])]
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ params, sql })
          expect(sql.match(/\?/g)?.length ?? 0).toBe(params.length)
          return {
            async first() {
              return first.shift() ?? null
            },
            async all() {
              return {
                results: all.shift() ?? [],
                success: true,
                meta: {},
              }
            },
            async run() {
              return {
                success: true,
                meta: { changes: run.shift()?.changes ?? 0 },
              }
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { calls, db }
}

describe('social graph core', () => {
  it('hides a private Team Project from outsiders but resolves public and member targets', async () => {
    const privateRow = {
      id: 'project-private',
      owner_user_id: null,
      owner_team_id: 'team-paperboy',
      owner_handle: 'paperboy',
      slug: 'private',
      public_target: 0,
      live_public: 0,
      viewer_member: 0,
    }
    const { db } = scriptedDb({
      first: [
        privateRow,
        {
          ...privateRow,
          id: 'project-public',
          slug: 'public',
          public_target: 1,
          live_public: 1,
        },
        { ...privateRow, viewer_member: 1 },
      ],
    })

    await expect(resolveProjectSocialTarget(db, 'paperboy', 'private', null)).resolves.toBeNull()
    await expect(resolveProjectSocialTarget(db, 'paperboy', 'public', null)).resolves.toMatchObject(
      {
        projectId: 'project-public',
        isPublic: true,
        hasLivePublicSession: true,
      },
    )
    await expect(
      resolveProjectSocialTarget(db, 'paperboy', 'private', 'member'),
    ).resolves.toMatchObject({
      projectId: 'project-private',
      isPublic: false,
      hasLivePublicSession: false,
    })
  })

  it('lets a private Team member Watch without making the Project Star-eligible', async () => {
    const { db } = scriptedDb({
      first: [
        {
          public_target: 0,
          live_public: 0,
          viewer_authenticated: 1,
          star_count: 0,
          watcher_count: 1,
          viewer_starred: 0,
          viewer_watching: 1,
          can_star: 0,
          can_watch: 1,
        },
      ],
    })

    await expect(
      getProjectSocialState(
        db,
        {
          projectId: 'project-private',
          ownerUserId: null,
          ownerTeamId: 'team-paperboy',
          ownerHandle: 'paperboy',
          slug: 'private',
          isPublic: false,
          hasLivePublicSession: false,
        },
        'member',
      ),
    ).resolves.toMatchObject({
      starCount: 0,
      watcherCount: 1,
      viewerStarred: false,
      viewerWatching: true,
      viewerAuthenticated: true,
      starEligible: false,
      canStar: false,
      canWatch: true,
    })
  })

  it('revalidates a stale public target before returning social state', async () => {
    const { calls, db } = scriptedDb({ first: [null] })
    await expect(
      getProjectSocialState(
        db,
        {
          projectId: 'project-public',
          ownerUserId: null,
          ownerTeamId: 'team-paperboy',
          ownerHandle: 'paperboy',
          slug: 'public',
          isPublic: true,
          hasLivePublicSession: true,
        },
        null,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params).toEqual([null, 'project-public', 'paperboy', 'public'])
    expect(calls[0]?.sql).toContain('JOIN hub_session_discovery live_projection')
    expect(calls[0]?.sql).toContain('route_handle.handle=?')
  })

  it('does not expose stargazers after the final Public Session disappears', async () => {
    const { calls, db } = scriptedDb({ all: [[]] })
    await expect(
      listProjectStargazers(
        db,
        {
          projectId: 'project-public',
          ownerUserId: null,
          ownerTeamId: 'team-paperboy',
          ownerHandle: 'paperboy',
          slug: 'public',
          isPublic: true,
          hasLivePublicSession: true,
        },
        { after: null, fingerprint: 'scope', limit: 30 },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params.slice(0, 3)).toEqual(['project-public', 'paperboy', 'public'])
    expect(calls[0]?.sql).toContain('JOIN hub_session_discovery live_projection')
  })

  it('distinguishes a public Project with zero stargazers from an unavailable Project', async () => {
    const { db } = scriptedDb({
      all: [[{ authorized_project_id: 'project-public' }]],
    })
    await expect(
      listProjectStargazers(
        db,
        {
          projectId: 'project-public',
          ownerUserId: null,
          ownerTeamId: 'team-paperboy',
          ownerHandle: 'paperboy',
          slug: 'public',
          isPublic: true,
          hasLivePublicSession: true,
        },
        { after: null, fingerprint: 'scope', limit: 30 },
      ),
    ).resolves.toEqual({ rows: [], nextCursor: null })
  })

  it('requires a live Public Session for Star while allowing a current private Team Watch', async () => {
    const target = {
      projectId: 'project-private',
      ownerUserId: null,
      ownerTeamId: 'team-paperboy',
      ownerHandle: 'paperboy',
      slug: 'private',
      isPublic: false,
      hasLivePublicSession: false,
    }
    const star = scriptedDb({ run: [{ changes: 0 }], first: [] })
    await expect(starProject(star.db, target, 'member', 1)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(star.calls[0]?.sql).not.toContain('member.user_id=actor.id')

    const watch = scriptedDb({ run: [{ changes: 1 }] })
    await expect(watchProject(watch.db, target, 'member', 1)).resolves.toBeUndefined()
    expect(watch.calls[0]?.sql).toContain('member.user_id=actor.id')
  })

  it('returns a no-store 401 before an anonymous Project-star mutation reaches D1', async () => {
    const { calls, db } = scriptedDb({})
    const response = await invoke(
      projectStarPut,
      new Request('https://spool.example.test/api/owners/paperboy/projects/spool/star', {
        method: 'PUT',
      }),
      { DB: db, RATE: makeKv(), SESSIONS: makeKv() },
      { handle: 'paperboy', slug: 'spool' },
    )
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    await expect(response.json()).resolves.toMatchObject({ error: 'UNAUTHENTICATED' })
    expect(calls).toEqual([])
  })

  it('binds the public starred-Projects query without a private-membership parameter', async () => {
    const { calls, db } = scriptedDb({
      first: [{ id: 'user-doodlewind' }],
      all: [[]],
    })
    await expect(
      listStarredProjectsForOwner(db, 'doodlewind', {
        after: null,
        fingerprint: 'scope',
        limit: 30,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null })
    expect(calls).toHaveLength(2)
  })

  it('keeps authenticated Starred Projects restricted to live Public targets', async () => {
    const { calls, db } = scriptedDb({ all: [[]] })
    await expect(
      listStarredProjectsForUser(db, 'user-doodlewind', {
        after: null,
        fingerprint: 'scope',
        limit: 30,
      }),
    ).resolves.toEqual({ rows: [], nextCursor: null })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params.slice(0, 2)).toEqual(['user-doodlewind', 0])
    expect(calls[0]?.sql).not.toContain('viewer_member')
  })

  it('serves the authenticated starred-Projects endpoint without leaking cursor fields', async () => {
    const now = Date.now()
    const { db } = scriptedDb({
      first: [
        {
          id: 'user-doodlewind',
          email: 'doodlewind@qq.com',
          name: 'Doodlewind',
          avatar_url: null,
          created_at: 1,
          last_signin_at: 1,
          deletion_pending_until: null,
          deleted_at: null,
          display_name: null,
          custom_avatar_id: null,
          avatar_visible: 1,
        },
      ],
      all: [
        [
          {
            social_id: 'project-react-vapor',
            social_created_at: 20,
            id: 'project-react-vapor',
            slug: 'react-vapor',
            name: 'React Vapor',
            description: 'Run React with fine-grained DOM updates.',
            github_url: 'https://github.com/paperboytm/react-vapor',
            owner_user_id: 'user-doodlewind',
            owner_team_id: null,
            owner_handle: 'doodlewind',
            owner_email: 'doodlewind@qq.com',
            owner_name: 'Doodlewind',
            owner_display_name: null,
            owner_avatar_url: null,
            owner_custom_avatar_id: null,
            owner_avatar_visible: 1,
            public_target: 1,
            public_session_count: 1,
            tenant_session_count: 1,
            star_count: 8,
            updated_at: 19,
          },
        ],
      ],
    })
    const sessions = makeKv()
    const rate = makeKv()
    const token = 's'.repeat(40)
    await sessions.put(
      `session/${token}`,
      JSON.stringify({
        user_id: 'user-doodlewind',
        created: now,
        exp: now + 60_000,
        last_seen: now,
      }),
      { expirationTtl: 60 },
    )

    const response = await invoke(
      meStarredProjectsGet,
      new Request('https://spool.example.test/api/me/starred-projects', {
        headers: { cookie: `spool_session=${token}` },
      }),
      { DB: db, RATE: rate, SESSIONS: sessions },
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('vary')).toBe('Cookie, Authorization')
    const body = await response.json()
    expect(body).toEqual({
      projects: [
        {
          id: 'project-react-vapor',
          slug: 'react-vapor',
          name: 'React Vapor',
          description: 'Run React with fine-grained DOM updates.',
          github_url: 'https://github.com/paperboytm/react-vapor',
          owner: {
            kind: 'user',
            id: 'user-doodlewind',
            handle: 'doodlewind',
            name: 'Doodlewind',
            avatar_url: null,
          },
          session_count: 1,
          star_count: 8,
          updated_at: 19,
        },
      ],
      next_cursor: null,
    })
    expect(JSON.stringify(body)).not.toContain('social_')
  })

  it('resolves active personal handles and exposes public follow counts', async () => {
    const targetRow = {
      id: 'user-doodlewind',
      handle: 'doodlewind',
      email: 'doodlewind@qq.com',
      name: 'Doodlewind',
      display_name: null,
      avatar_url: null,
      custom_avatar_id: null,
      avatar_visible: 1,
    }
    const { db } = scriptedDb({
      first: [
        targetRow,
        {
          follower_count: 12,
          following_count: 7,
          viewer_following: 1,
          viewer_authenticated: 1,
          viewer_is_self: 0,
          can_follow: 1,
        },
      ],
    })
    const target = await resolveUserFollowTarget(db, 'doodlewind')
    expect(target).toMatchObject({
      id: 'user-doodlewind',
      handle: 'doodlewind',
      name: 'Doodlewind',
    })
    await expect(getUserFollowState(db, target!, 'viewer')).resolves.toEqual({
      version: 1,
      followerCount: 12,
      followingCount: 7,
      viewerFollowing: true,
      viewerAuthenticated: true,
      viewerIsSelf: false,
      canFollow: true,
    })
  })

  it('distinguishes anonymous viewers from the profile owner', async () => {
    const target = {
      id: 'user-doodlewind',
      handle: 'doodlewind',
      name: 'Doodlewind',
      avatar_url: null,
    }
    const { db } = scriptedDb({
      first: [
        {
          follower_count: 12,
          following_count: 7,
          viewer_following: 0,
          viewer_authenticated: 0,
          viewer_is_self: 0,
          can_follow: 0,
        },
        {
          follower_count: 12,
          following_count: 7,
          viewer_following: 0,
          viewer_authenticated: 1,
          viewer_is_self: 1,
          can_follow: 0,
        },
      ],
    })
    await expect(getUserFollowState(db, target, null)).resolves.toMatchObject({
      viewerAuthenticated: false,
      viewerIsSelf: false,
      canFollow: false,
    })
    await expect(getUserFollowState(db, target, 'user-doodlewind')).resolves.toMatchObject({
      viewerAuthenticated: true,
      viewerIsSelf: true,
      canFollow: false,
    })
  })

  it('forbids following yourself before attempting a write', async () => {
    const { calls, db } = scriptedDb({})
    await expect(
      followUser(
        db,
        {
          id: 'same-user',
          handle: 'same-user',
          name: 'Same User',
          avatar_url: null,
        },
        'same-user',
      ),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
      detail: 'You cannot follow yourself',
    })
    expect(calls).toEqual([])
  })

  it('keeps list cursors scoped and opaque', async () => {
    const options = await parseSocialListOptions(
      new Request('https://spool.example.test/api/list?limit=1'),
      ['followers', 'user-a'],
    )
    const page = finishSocialListPage(
      [
        { social_created_at: 20, social_id: 'a' },
        { social_created_at: 10, social_id: 'b' },
      ],
      options,
    )
    expect(page.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const nextRequest = new Request(`https://spool.example.test/api/list?cursor=${page.nextCursor}`)
    await expect(
      parseSocialListOptions(nextRequest, ['followers', 'user-a']),
    ).resolves.toMatchObject({
      after: { createdAt: 20, id: 'a' },
    })
    await expect(
      parseSocialListOptions(nextRequest, ['following', 'user-a']),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      detail: 'malformed cursor',
    })
  })

  it('migrates all three relationships with lifecycle cleanup', async () => {
    const sql = await readFile(
      join(dirname(fileURLToPath(import.meta.url)), '../migrations/0015_social_graph.sql'),
      'utf8',
    )
    expect(sql).toContain('CREATE TABLE project_stars')
    expect(sql).toContain('CREATE TABLE project_watches')
    expect(sql).toContain('CREATE TABLE user_follows')
    expect(sql).toContain('CREATE TRIGGER projects_clear_social_on_archive')
    expect(sql).toContain('CREATE TRIGGER team_memberships_clear_project_social')
    expect(sql).toContain('CREATE TRIGGER users_clear_social_on_delete')
  })
})

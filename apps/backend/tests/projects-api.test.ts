import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { describe, expect, it } from 'vite-plus/test'

import {
  onRequestGet as hubProjectsGet,
  onRequestPost as hubProjectsPost,
} from '../functions/api/hub/v1/projects'
import { onRequestPatch as personalProjectPatch } from '../functions/api/me/projects/[projectId]'
import {
  onRequestGet as personalProjectsGet,
  onRequestPost as personalProjectsPost,
} from '../functions/api/me/projects/index'
import { onRequestGet as ownerProjectGet } from '../functions/api/owners/[handle]/projects/[slug]'
import { onRequestGet as ownerProjectsGet } from '../functions/api/owners/[handle]/projects/index'
import { onRequestGet as publicProjectsGet } from '../functions/api/projects'
import { onRequestGet as teamProjectGet } from '../functions/api/teams/[teamId]/projects/[projectId]'
import {
  onRequestGet as teamProjectsGet,
  onRequestPost as teamProjectsPost,
} from '../functions/api/teams/[teamId]/projects/index'
import type { SessionRecord } from '../src/auth/session'
import { validateHead } from '../src/hub/head'
import {
  MAX_ACTIVE_PROJECTS_PER_TENANT,
  MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR,
  MAX_PROJECTS_PER_TENANT,
  PROJECT_CREATE_RATE,
  PROJECT_LIST_RATE,
} from '../src/projects/limits'
import {
  listPublicProjectSessions,
  prepareAuthorizedDefaultProjectInsert,
} from '../src/projects/store'
import { invoke } from './_helpers/ctx'
import { emptyState, makeDb, makeKv, makeR2 } from './_helpers/fakes'

const BASE_URL = 'https://spool.example.test'
const USER_TOKEN = 'a'.repeat(40)
const MEMBER_TOKEN = 'b'.repeat(40)
const OUTSIDER_TOKEN = 'c'.repeat(40)
const TEAM_ID = `team_${'d'.repeat(32)}`

function envFor() {
  const { db, state } = makeDb(emptyState())
  const hub = makeR2()
  return {
    DB: db,
    SESSIONS: makeKv(),
    RATE: makeKv(),
    HUB: hub.bucket,
    state,
  }
}

type TestEnv = ReturnType<typeof envFor>

function seedUser(
  env: TestEnv,
  id: string,
  overrides: Partial<TestEnv['state']['users'][number]> = {},
): void {
  const now = Date.now()
  env.state.users.push({
    id,
    email: `${id}@example.test`,
    name: id,
    avatar_url: null,
    created_at: now,
    last_signin_at: now,
    deletion_pending_until: null,
    deleted_at: null,
    ...overrides,
  })
}

async function seedSession(kv: KVNamespace, token: string, userId: string): Promise<void> {
  const now = Date.now()
  const session: SessionRecord = {
    user_id: userId,
    created: now,
    exp: now + 60_000,
    last_seen: now,
  }
  await kv.put(`session/${token}`, JSON.stringify(session), { expirationTtl: 60 })
}

async function seedActors(env: TestEnv): Promise<void> {
  seedUser(env, 'user-a')
  seedUser(env, 'user-b')
  seedUser(env, 'user-c')
  await Promise.all([
    seedSession(env.SESSIONS, USER_TOKEN, 'user-a'),
    seedSession(env.SESSIONS, MEMBER_TOKEN, 'user-b'),
    seedSession(env.SESSIONS, OUTSIDER_TOKEN, 'user-c'),
  ])
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  token = USER_TOKEN,
  headers: Record<string, string> = {},
): Request {
  const projectCreateHeaders =
    method === 'POST' &&
    /\/projects$/.test(path) &&
    headers['idempotency-key'] === undefined &&
    headers['Idempotency-Key'] === undefined
      ? { 'idempotency-key': `test-project-${crypto.randomUUID()}` }
      : {}
  return new Request(`${BASE_URL}${path}`, {
    method,
    headers: {
      cookie: `spool_session=${token}`,
      'content-type': 'application/json',
      ...projectCreateHeaders,
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

function getRequest(path: string, token?: string): Request {
  return new Request(`${BASE_URL}${path}`, {
    headers: token ? { cookie: `spool_session=${token}` } : {},
  })
}

async function createPersonalProject(
  env: TestEnv,
  body: Record<string, unknown> = { name: 'Compiler work', slug: 'compiler-work' },
): Promise<Record<string, any>> {
  const response = await invoke(
    personalProjectsPost,
    jsonRequest('/api/me/projects', 'POST', body),
    env,
  )
  expect(response.status).toBe(201)
  return (await response.json()) as Record<string, any>
}

describe('Projects API contract', () => {
  it('creates and lists personal Projects with a non-null, non-email handle and fixed fields', async () => {
    const env = envFor()
    seedUser(env, 'user-a', {
      email: 'private-address@example.test',
      name: null,
      display_name: null,
      avatar_url: 'https://example.test/private.png',
      avatar_visible: 0,
    })
    await seedSession(env.SESSIONS, USER_TOKEN, 'user-a')

    const created = await createPersonalProject(env)
    expect(created.project).toMatchObject({
      slug: 'compiler-work',
      session_count: 0,
      archived_at: null,
      can_manage: true,
      owner: {
        kind: 'user',
        id: 'user-a',
        name: 'private-address',
        avatar_url: null,
      },
    })
    expect(created.project.owner.handle).toMatch(/^user-[a-z0-9]+$/)
    expect(JSON.stringify(created)).not.toContain('@example.test')

    const listed = await invoke(
      personalProjectsGet,
      getRequest('/api/me/projects', USER_TOKEN),
      env,
    )
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      projects: [
        {
          id: created.project.id,
          session_count: 0,
          archived_at: null,
          can_manage: true,
        },
      ],
      next_cursor: null,
    })

    const archived = await invoke(
      personalProjectPatch,
      jsonRequest(`/api/me/projects/${created.project.id}`, 'PATCH', { archived: true }),
      env,
      { projectId: created.project.id },
    )
    expect(archived.status).toBe(200)
    await expect(archived.json()).resolves.toMatchObject({
      project: { archived_at: expect.any(Number), session_count: 0, can_manage: true },
    })
  })

  it('atomically refuses to archive a Project after a Session is linked', async () => {
    const env = envFor()
    await seedActors(env)
    const created = await createPersonalProject(env)
    const projectId = created.project.id as string
    env.state.hub_sessions.push(sessionRow(projectId))

    const response = await invoke(
      personalProjectPatch,
      jsonRequest(`/api/me/projects/${projectId}`, 'PATCH', { archived: true }),
      env,
      { projectId },
    )
    expect(response.status).toBe(409)
    expectPrivate(response)
    await expect(response.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: 'Move its Sessions before archiving',
    })
    expect(env.state.projects.find((project) => project.id === projectId)?.archived_at).toBeNull()
  })

  it('archives a Project with only withdrawn Sessions, preserves history, and rejects a new head', async () => {
    const env = envFor()
    await seedActors(env)
    const created = await createPersonalProject(env)
    const projectId = created.project.id as string
    const withdrawn = sessionRow(projectId, { withdrawn_at: 30 })
    env.state.hub_sessions.push(withdrawn)

    const response = await invoke(
      personalProjectPatch,
      jsonRequest(`/api/me/projects/${projectId}`, 'PATCH', { archived: true }),
      env,
      { projectId },
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      project: {
        id: projectId,
        archived_at: expect.any(Number),
        session_count: 0,
      },
    })
    expect(env.state.hub_sessions[0]?.project_id).toBe(projectId)

    await expect(
      validateHead(env.DB, 'user-a', withdrawn.sid, {
        root: 'a'.repeat(64),
        count: 1,
        manifest: ['b'.repeat(64)],
        sig: null,
        cardJson: null,
        summaryMd: null,
        lineageJson: null,
        viewOid: 'c'.repeat(64),
        spoolFileOid: null,
      }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      detail: 'Session Project is archived or unavailable',
    })
  })

  it('keeps the fallback Project active and treats archive as a terminal transition', async () => {
    const env = envFor()
    await seedActors(env)
    const created = await createPersonalProject(env)
    const fallbackInsert = await prepareAuthorizedDefaultProjectInsert(env.DB, {
      actorUserId: 'user-a',
      tenant: { userId: 'user-a', teamId: null },
      now: Date.now(),
    }).run()
    expect(fallbackInsert.meta.changes).toBe(1)

    const fallbackId = 'project_default_user_user-a'
    const archiveFallback = await invoke(
      personalProjectPatch,
      jsonRequest(`/api/me/projects/${fallbackId}`, 'PATCH', { archived: true }),
      env,
      { projectId: fallbackId },
    )
    expect(archiveFallback.status).toBe(409)
    await expect(archiveFallback.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: 'Default Project cannot be archived',
    })
    expect(env.state.projects.find((project) => project.id === fallbackId)?.archived_at).toBeNull()

    const restoreActive = await invoke(
      personalProjectPatch,
      jsonRequest(`/api/me/projects/${created.project.id}`, 'PATCH', { archived: false }),
      env,
      { projectId: created.project.id as string },
    )
    expect(restoreActive.status).toBe(422)
    await expect(restoreActive.json()).resolves.toMatchObject({
      error: 'UNPROCESSABLE',
      detail: 'invalid Project update',
    })

    const legacy = envFor()
    await seedActors(legacy)
    await createPersonalProject(legacy)
    legacy.state.projects.push(
      projectRow({
        id: 'project_legacy_sessions',
        slug: 'sessions',
        name: 'Sessions',
        ownerUserId: 'user-a',
        ownerTeamId: null,
        updatedAt: 2,
      }),
    )
    const archiveLegacyFallback = await invoke(
      personalProjectPatch,
      jsonRequest('/api/me/projects/project_legacy_sessions', 'PATCH', { archived: true }),
      legacy,
      { projectId: 'project_legacy_sessions' },
    )
    expect(archiveLegacyFallback.status).toBe(409)
    await expect(archiveLegacyFallback.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: 'Default Project cannot be archived',
    })
  })

  it('enforces the 100-active-Project quota in personal, Team, and Hub create paths', async () => {
    const personal = envFor()
    await seedActors(personal)
    const firstPersonal = await createPersonalProject(personal)
    seedProjectsToLimit(personal, {
      ownerUserId: 'user-a',
      ownerTeamId: null,
      existing: 1,
    })
    const personalResponse = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', {
        name: 'Over quota',
        slug: 'over-quota',
      }),
      personal,
    )
    expect(personalResponse.status).toBe(409)
    await expect(personalResponse.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: `active Project limit reached (${MAX_ACTIVE_PROJECTS_PER_TENANT})`,
    })
    expect(personal.state.projects).toHaveLength(MAX_ACTIVE_PROJECTS_PER_TENANT)
    expect(firstPersonal.project.id).toBeTruthy()
    const defaultAtCapacity = await prepareAuthorizedDefaultProjectInsert(personal.DB, {
      actorUserId: 'user-a',
      tenant: { userId: 'user-a', teamId: null },
      now: Date.now(),
    }).run()
    expect(defaultAtCapacity.meta.changes).toBe(0)
    expect(personal.state.projects).toHaveLength(MAX_ACTIVE_PROJECTS_PER_TENANT)

    const team = envFor()
    await seedActors(team)
    team.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    team.state.team_memberships.push({
      team_id: TEAM_ID,
      user_id: 'user-a',
      role: 'owner',
    })
    await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', {
        name: 'First Team Project',
        slug: 'first-team-project',
      }),
      team,
      { teamId: TEAM_ID },
    )
    seedProjectsToLimit(team, {
      ownerUserId: null,
      ownerTeamId: TEAM_ID,
      existing: 1,
    })
    const teamResponse = await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', {
        name: 'Team over quota',
        slug: 'team-over-quota',
      }),
      team,
      { teamId: TEAM_ID },
    )
    expect(teamResponse.status).toBe(409)
    expect(team.state.projects).toHaveLength(MAX_ACTIVE_PROJECTS_PER_TENANT)

    const hub = envFor()
    await seedActors(hub)
    await createPersonalProject(hub)
    seedProjectsToLimit(hub, {
      ownerUserId: 'user-a',
      ownerTeamId: null,
      existing: 1,
    })
    const hubResponse = await invoke(
      hubProjectsPost,
      jsonRequest(
        '/api/hub/v1/projects',
        'POST',
        {
          owner: { kind: 'user', id: 'user-a' },
          name: 'Hub over quota',
          slug: 'hub-over-quota',
        },
        USER_TOKEN,
        { 'idempotency-key': 'hub-project-over-quota' },
      ),
      hub,
    )
    expect(hubResponse.status).toBe(409)
    expect(hub.state.projects).toHaveLength(MAX_ACTIVE_PROJECTS_PER_TENANT)
  })

  it('bounds archived Project history per tenant without deleting tombstones', async () => {
    const env = envFor()
    await seedActors(env)
    await createPersonalProject(env)
    env.state.projects[0]!.archived_at = 1
    for (let index = 1; index < MAX_PROJECTS_PER_TENANT; index += 1) {
      env.state.projects.push(
        projectRow({
          id: `project_history_${String(index).padStart(4, '0')}`,
          slug: `history-${String(index).padStart(4, '0')}`,
          name: `History ${index}`,
          ownerUserId: 'user-a',
          ownerTeamId: null,
          updatedAt: index + 1,
          archivedAt: index + 1,
        }),
      )
    }

    const response = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', {
        name: 'Past history limit',
        slug: 'past-history-limit',
      }),
      env,
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: `Project history limit reached (${MAX_PROJECTS_PER_TENANT})`,
    })
    expect(env.state.projects).toHaveLength(MAX_PROJECTS_PER_TENANT)

    const fallbackAtCapacity = await prepareAuthorizedDefaultProjectInsert(env.DB, {
      actorUserId: 'user-a',
      tenant: { userId: 'user-a', teamId: null },
      now: Date.now(),
    }).run()
    expect(fallbackAtCapacity.meta.changes).toBe(0)
    expect(env.state.projects).toHaveLength(MAX_PROJECTS_PER_TENANT)
  })

  it('bounds durable Project creation receipts per actor', async () => {
    const env = envFor()
    await seedActors(env)
    await createPersonalProject(env)
    for (
      let index = env.state.project_creation_requests.length;
      index < MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR;
      index += 1
    ) {
      env.state.project_creation_requests.push({
        actor_user_id: 'user-a',
        owner_scope: 'user:user-a',
        owner_user_id: 'user-a',
        owner_team_id: null,
        idempotency_key: `historical-request-${index}`,
        project_id: `project_historical_receipt_${index}`,
        request_hash: String(index).padStart(64, '0'),
        created_at: index,
      })
    }

    const response = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', {
        name: 'Past receipt limit',
        slug: 'past-receipt-limit',
      }),
      env,
    )
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'CONFLICT',
      detail: `Project creation receipt limit reached (${MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR})`,
    })
    expect(env.state.projects).toHaveLength(1)
    expect(env.state.project_creation_requests).toHaveLength(
      MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR,
    )
  })

  it('enforces the Project description limit as 4 KiB of UTF-8', async () => {
    const accepted = envFor()
    await seedActors(accepted)
    const acceptedResponse = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', {
        name: 'Exact description',
        slug: 'exact-description',
        description: 'a'.repeat(4 * 1024),
      }),
      accepted,
    )
    expect(acceptedResponse.status).toBe(201)

    const rejected = envFor()
    await seedActors(rejected)
    const rejectedResponse = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', {
        name: 'Oversized description',
        slug: 'oversized-description',
        description: '中'.repeat(1_366),
      }),
      rejected,
    )
    expect(rejectedResponse.status).toBe(422)
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      error: 'UNPROCESSABLE',
      detail: 'invalid Project',
    })
  })

  it('paginates private Project lists stably and binds cursors to their scope', async () => {
    const env = envFor()
    await seedActors(env)
    await createPersonalProject(env)
    const original = env.state.projects[0]!
    original.updated_at = 30
    env.state.projects.push(
      projectRow({
        id: 'project_22222222',
        slug: 'second',
        name: 'Second',
        ownerUserId: 'user-a',
        ownerTeamId: null,
        updatedAt: 20,
      }),
      projectRow({
        id: 'project_33333333',
        slug: 'third',
        name: 'Third',
        ownerUserId: 'user-a',
        ownerTeamId: null,
        updatedAt: 10,
      }),
    )

    const first = await invoke(
      personalProjectsGet,
      getRequest('/api/me/projects?limit=2', USER_TOKEN),
      env,
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as Record<string, any>
    expect(firstBody.projects.map((project: Record<string, unknown>) => project.id)).toEqual([
      original.id,
      'project_22222222',
    ])
    expect(firstBody.next_cursor).toEqual(expect.any(String))

    const second = await invoke(
      personalProjectsGet,
      getRequest(
        `/api/me/projects?limit=2&cursor=${encodeURIComponent(firstBody.next_cursor as string)}`,
        USER_TOKEN,
      ),
      env,
    )
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({
      projects: [{ id: 'project_33333333' }],
      next_cursor: null,
    })

    env.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    env.state.team_memberships.push({
      team_id: TEAM_ID,
      user_id: 'user-a',
      role: 'owner',
    })
    const mismatched = await invoke(
      teamProjectsGet,
      getRequest(
        `/api/teams/${TEAM_ID}/projects?limit=2&cursor=${encodeURIComponent(
          firstBody.next_cursor as string,
        )}`,
        USER_TOKEN,
      ),
      env,
      { teamId: TEAM_ID },
    )
    expect(mismatched.status).toBe(400)
  })

  it('rate-limits Project create and list entrypoints with the shared actor buckets', async () => {
    const env = envFor()
    await seedActors(env)
    env.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    env.state.team_memberships.push({
      team_id: TEAM_ID,
      user_id: 'user-a',
      role: 'owner',
    })
    const createSlot = Math.floor(Math.floor(Date.now() / 1000) / PROJECT_CREATE_RATE.windowSec)
    await env.RATE.put(
      `rate/${PROJECT_CREATE_RATE.bucket}/user-a/${createSlot}`,
      String(PROJECT_CREATE_RATE.max),
    )
    const webCreate = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', { name: 'Limited', slug: 'limited' }),
      env,
    )
    expect(webCreate.status).toBe(429)
    const hubCreate = await invoke(
      hubProjectsPost,
      jsonRequest(
        '/api/hub/v1/projects',
        'POST',
        {
          owner: { kind: 'user', id: 'user-a' },
          name: 'Limited Hub',
          slug: 'limited-hub',
        },
        USER_TOKEN,
        { 'idempotency-key': 'limited-hub-project' },
      ),
      env,
    )
    expect(hubCreate.status).toBe(429)
    const teamCreate = await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', {
        name: 'Limited Team',
        slug: 'limited-team',
      }),
      env,
      { teamId: TEAM_ID },
    )
    expect(teamCreate.status).toBe(429)

    const listEnv = envFor()
    await seedActors(listEnv)
    listEnv.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    listEnv.state.team_memberships.push({
      team_id: TEAM_ID,
      user_id: 'user-a',
      role: 'owner',
    })
    const listSlot = Math.floor(Math.floor(Date.now() / 1000) / PROJECT_LIST_RATE.windowSec)
    await listEnv.RATE.put(
      `rate/${PROJECT_LIST_RATE.bucket}/user-a/${listSlot}`,
      String(PROJECT_LIST_RATE.max),
    )
    const webList = await invoke(
      personalProjectsGet,
      getRequest('/api/me/projects', USER_TOKEN),
      listEnv,
    )
    expect(webList.status).toBe(429)
    const hubList = await invoke(
      hubProjectsGet,
      getRequest('/api/hub/v1/projects', USER_TOKEN),
      listEnv,
    )
    expect(hubList.status).toBe(429)
    const teamList = await invoke(
      teamProjectsGet,
      getRequest(`/api/teams/${TEAM_ID}/projects`, USER_TOKEN),
      listEnv,
      { teamId: TEAM_ID },
    )
    expect(teamList.status).toBe(429)
  })

  it('keeps Hub Project creation idempotent and enforces owner permissions', async () => {
    const env = envFor()
    await seedActors(env)
    env.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    env.state.team_memberships.push(
      { team_id: TEAM_ID, user_id: 'user-a', role: 'owner' },
      { team_id: TEAM_ID, user_id: 'user-b', role: 'member' },
    )

    const body = {
      owner: { kind: 'user', id: 'user-a' },
      name: 'Hub Project',
      slug: 'hub-project',
    }
    const first = await invoke(
      hubProjectsPost,
      jsonRequest('/api/hub/v1/projects', 'POST', body, USER_TOKEN, {
        'idempotency-key': 'project-request-1',
      }),
      env,
    )
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as Record<string, any>

    const replay = await invoke(
      hubProjectsPost,
      jsonRequest('/api/hub/v1/projects', 'POST', body, USER_TOKEN, {
        'idempotency-key': 'project-request-1',
      }),
      env,
    )
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({
      project: {
        id: firstBody.project.id,
        owner: { id: 'user-a', handle: expect.any(String) },
        session_count: 0,
        archived_at: null,
        can_manage: true,
      },
    })
    expect(env.state.projects.filter((project) => project.slug === 'hub-project')).toHaveLength(1)

    const conflict = await invoke(
      hubProjectsPost,
      jsonRequest('/api/hub/v1/projects', 'POST', { ...body, name: 'Different' }, USER_TOKEN, {
        'idempotency-key': 'project-request-1',
      }),
      env,
    )
    expect(conflict.status).toBe(409)
    expectPrivate(conflict)

    const forbidden = await invoke(
      hubProjectsPost,
      jsonRequest(
        '/api/hub/v1/projects',
        'POST',
        {
          owner: { kind: 'team', id: TEAM_ID },
          name: 'Member cannot create',
          slug: 'member-cannot-create',
        },
        MEMBER_TOKEN,
        { 'idempotency-key': 'project-request-2' },
      ),
      env,
    )
    expect(forbidden.status).toBe(403)
    expectPrivate(forbidden)

    const listed = await invoke(hubProjectsGet, getRequest('/api/hub/v1/projects', USER_TOKEN), env)
    expect(listed.status).toBe(200)
    await expect(listed.json()).resolves.toMatchObject({
      actor: { id: 'user-a' },
      projects: [
        {
          id: firstBody.project.id,
          owner: { handle: expect.any(String) },
          can_manage: true,
        },
      ],
    })
  })

  it('replays personal and Team Project creates from the same durable receipt', async () => {
    const env = envFor()
    await seedActors(env)
    const personalHeaders = { 'idempotency-key': 'personal-project-retry-1' }
    const personalBody = { name: 'Retry safe', slug: 'retry-safe' }
    const first = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', personalBody, USER_TOKEN, personalHeaders),
      env,
    )
    expect(first.status).toBe(201)
    const firstBody = (await first.json()) as Record<string, any>
    const replay = await invoke(
      personalProjectsPost,
      jsonRequest('/api/me/projects', 'POST', personalBody, USER_TOKEN, personalHeaders),
      env,
    )
    expect(replay.status).toBe(200)
    await expect(replay.json()).resolves.toMatchObject({
      project: { id: firstBody.project.id },
    })
    expect(env.state.projects).toHaveLength(1)

    const conflict = await invoke(
      personalProjectsPost,
      jsonRequest(
        '/api/me/projects',
        'POST',
        { ...personalBody, name: 'Different retry' },
        USER_TOKEN,
        personalHeaders,
      ),
      env,
    )
    expect(conflict.status).toBe(409)

    env.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    env.state.team_memberships.push({
      team_id: TEAM_ID,
      user_id: 'user-a',
      role: 'owner',
    })
    const teamHeaders = { 'idempotency-key': 'team-project-retry-1' }
    const teamBody = { name: 'Team retry safe', slug: 'team-retry-safe' }
    const teamFirst = await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', teamBody, USER_TOKEN, teamHeaders),
      env,
      { teamId: TEAM_ID },
    )
    expect(teamFirst.status).toBe(201)
    const teamFirstBody = (await teamFirst.json()) as Record<string, any>
    const teamReplay = await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', teamBody, USER_TOKEN, teamHeaders),
      env,
      { teamId: TEAM_ID },
    )
    expect(teamReplay.status).toBe(200)
    await expect(teamReplay.json()).resolves.toMatchObject({
      project: { id: teamFirstBody.project.id },
    })
    expect(env.state.projects.filter((project) => project.owner_team_id === TEAM_ID)).toHaveLength(
      1,
    )
  })

  it('keeps private Team Projects in the workspace and publishes only their public projection', async () => {
    const env = envFor()
    await seedActors(env)
    env.state.teams.push({ id: TEAM_ID, name: 'Paperboy', archived_at: null })
    env.state.team_memberships.push(
      { team_id: TEAM_ID, user_id: 'user-a', role: 'owner' },
      { team_id: TEAM_ID, user_id: 'user-b', role: 'member' },
    )

    const createdResponse = await invoke(
      teamProjectsPost,
      jsonRequest(`/api/teams/${TEAM_ID}/projects`, 'POST', {
        name: 'Private Team Project',
        slug: 'private-team-project',
      }),
      env,
      { teamId: TEAM_ID },
    )
    expect(createdResponse.status).toBe(201)
    expectPrivate(createdResponse)
    const created = (await createdResponse.json()) as Record<string, any>
    expect(created.project.owner).toMatchObject({
      kind: 'team',
      handle: expect.any(String),
      avatar_url: null,
    })

    const memberList = await invoke(
      teamProjectsGet,
      getRequest(`/api/teams/${TEAM_ID}/projects`, MEMBER_TOKEN),
      env,
      { teamId: TEAM_ID },
    )
    expect(memberList.status).toBe(200)
    expectPrivate(memberList)
    await expect(memberList.json()).resolves.toMatchObject({
      projects: [
        {
          id: created.project.id,
          owner: { handle: expect.any(String) },
          session_count: 0,
          archived_at: null,
          can_manage: false,
        },
      ],
      next_cursor: null,
    })

    const memberDetail = await invoke(
      teamProjectGet,
      getRequest(`/api/teams/${TEAM_ID}/projects/${created.project.id}`, MEMBER_TOKEN),
      env,
      { teamId: TEAM_ID, projectId: created.project.id },
    )
    expect(memberDetail.status).toBe(200)
    expectPrivate(memberDetail)
    await expect(memberDetail.json()).resolves.toMatchObject({
      project: { id: created.project.id, can_manage: false },
      sessions: [],
      next_cursor: null,
    })

    const handle = created.project.owner.handle as string
    for (const slug of ['private-team-project', 'does-not-exist']) {
      const anonymous = await invoke(
        ownerProjectGet,
        getRequest(`/api/owners/${handle}/projects/${slug}`),
        env,
        { handle, slug },
      )
      expect(anonymous.status).toBe(404)
      expect(anonymous.headers.get('cache-control')).toBe('no-store')
      expect(anonymous.headers.get('vary')).toBe('Cookie, Authorization')

      const outsider = await invoke(
        ownerProjectGet,
        getRequest(`/api/owners/${handle}/projects/${slug}`, OUTSIDER_TOKEN),
        env,
        { handle, slug },
      )
      expect(outsider.status).toBe(404)
      expect(outsider.headers.get('cache-control')).toBe('no-store')
      expect(outsider.headers.get('vary')).toBe('Cookie, Authorization')
    }

    const memberProfile = await invoke(
      ownerProjectsGet,
      getRequest(`/api/owners/${handle}/projects`, MEMBER_TOKEN),
      env,
      { handle },
    )
    expect(memberProfile.status).toBe(200)
    expect(memberProfile.headers.get('cache-control')).toBe('no-store')
    await expect(memberProfile.json()).resolves.toMatchObject({
      owner: { kind: 'team', handle },
      projects: [],
      session_count: 0,
      sessions: [],
    })

    env.state.hub_sessions.push(
      sessionRow(created.project.id as string, {
        team_id: TEAM_ID,
      }),
    )
    env.state.hub_session_discovery.push(discoveryRow())

    const publicProject = await invoke(
      ownerProjectGet,
      getRequest(`/api/owners/${handle}/projects/private-team-project`),
      env,
      { handle, slug: 'private-team-project' },
    )
    expect(publicProject.status).toBe(200)
    await expect(publicProject.json()).resolves.toMatchObject({
      owner: { kind: 'team', handle },
      project: {
        id: created.project.id,
        owner: { kind: 'team', handle },
        session_count: 1,
        can_manage: false,
      },
      sessions: [
        {
          sid: 'claude_project-session-1',
          team_id: TEAM_ID,
          visibility: 'public',
        },
      ],
    })

    const publicProfile = await invoke(
      ownerProjectsGet,
      getRequest(`/api/owners/${handle}/projects`),
      env,
      { handle },
    )
    expect(publicProfile.status).toBe(200)
    await expect(publicProfile.json()).resolves.toMatchObject({
      projects: [{ id: created.project.id, session_count: 1 }],
      sessions: [{ sid: 'claude_project-session-1', team_id: TEAM_ID }],
      session_count: 1,
    })

    const directory = await invoke(publicProjectsGet, getRequest('/api/projects'), env)
    expect(directory.status).toBe(200)
    await expect(directory.json()).resolves.toMatchObject({
      projects: [
        {
          id: created.project.id,
          owner: { kind: 'team', handle },
          session_count: 1,
        },
      ],
    })
  })

  it('404s when the final Project snapshot no longer has a live Team projection', async () => {
    const calls: Array<{ params: unknown[]; sql: string }> = []
    const db = {
      prepare(sql: string) {
        return {
          bind(...params: unknown[]) {
            calls.push({ params, sql })
            expect(sql.match(/\?/g)?.length ?? 0).toBe(params.length)
            return {
              async all() {
                return { results: [], success: true, meta: {} }
              },
            }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      listPublicProjectSessions(db, 'paperboy', 'react-vapor', {
        after: null,
        fingerprint: 'snapshot',
        limit: 20,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.params.slice(0, 2)).toEqual(['paperboy', 'react-vapor'])
    expect(calls[0]?.sql).toContain('authorized_project AS')
    expect(calls[0]?.sql).toContain('public_session_count>0')
    expect(calls[0]?.sql).toContain('LEFT JOIN page ON TRUE')
  })

  it('returns public personal Projects and Sessions while only the author can manage them', async () => {
    const env = envFor()
    seedUser(env, 'user-a', {
      email: 'reader-private@example.test',
      name: null,
      display_name: null,
      custom_avatar_id: 'avatar-v1',
      avatar_visible: 1,
    })
    await seedSession(env.SESSIONS, USER_TOKEN, 'user-a')
    const created = await createPersonalProject(env)
    const projectId = created.project.id as string
    env.state.hub_sessions.push(sessionRow(projectId))
    env.state.hub_session_discovery.push(discoveryRow())
    const handle = created.project.owner.handle as string

    const anonymous = await invoke(
      ownerProjectsGet,
      getRequest(`/api/owners/${handle}/projects`),
      env,
      { handle },
    )
    expect(anonymous.status).toBe(200)
    const anonymousBody = (await anonymous.json()) as Record<string, any>
    expect(anonymousBody).toMatchObject({
      owner: {
        handle,
        name: 'reader-private',
        avatar_url: '/api/avatars/user-a?v=avatar-v1',
      },
      projects: [
        {
          id: projectId,
          session_count: 1,
          archived_at: null,
          can_manage: false,
        },
      ],
      sessions: [
        {
          sid: 'claude_project-session-1',
          published_at: 10,
          updated_at: 20,
        },
      ],
      session_count: 1,
    })
    expect(JSON.stringify(anonymousBody)).not.toContain('@example.test')

    const author = await invoke(
      ownerProjectsGet,
      getRequest(`/api/owners/${handle}/projects`, USER_TOKEN),
      env,
      { handle },
    )
    expect(author.status).toBe(200)
    await expect(author.json()).resolves.toMatchObject({
      projects: [{ id: projectId, can_manage: true }],
    })

    const single = await invoke(
      ownerProjectGet,
      getRequest(`/api/owners/${handle}/projects/compiler-work`, USER_TOKEN),
      env,
      { handle, slug: 'compiler-work' },
    )
    expect(single.status).toBe(200)
    await expect(single.json()).resolves.toMatchObject({
      project: { id: projectId, can_manage: true },
      sessions: [{ sid: 'claude_project-session-1' }],
      next_cursor: null,
    })

    const global = await invoke(publicProjectsGet, getRequest('/api/projects'), env)
    expect(global.status).toBe(200)
    await expect(global.json()).resolves.toMatchObject({
      projects: [
        {
          id: projectId,
          owner: { handle, avatar_url: '/api/avatars/user-a?v=avatar-v1' },
          session_count: 1,
          archived_at: null,
          can_manage: false,
        },
      ],
      next_cursor: null,
    })
  })

  it('keeps an empty personal Project canonical while excluding it from the public directory', async () => {
    const env = envFor()
    await seedActors(env)
    const created = await createPersonalProject(env)
    const handle = created.project.owner.handle as string

    const canonical = await invoke(
      ownerProjectGet,
      getRequest(`/api/owners/${handle}/projects/compiler-work`),
      env,
      { handle, slug: 'compiler-work' },
    )
    expect(canonical.status).toBe(200)
    await expect(canonical.json()).resolves.toMatchObject({
      project: {
        id: created.project.id,
        session_count: 0,
        can_manage: false,
      },
      sessions: [],
      next_cursor: null,
    })

    const directory = await invoke(publicProjectsGet, getRequest('/api/projects'), env)
    expect(directory.status).toBe(200)
    await expect(directory.json()).resolves.toMatchObject({
      projects: [],
      next_cursor: null,
    })
  })

  it('paginates public Project Sessions with an opaque cursor bound to that Project', async () => {
    const env = envFor()
    await seedActors(env)
    const created = await createPersonalProject(env)
    const projectId = created.project.id as string
    const handle = created.project.owner.handle as string
    env.state.hub_sessions.push(
      sessionRow(projectId),
      sessionRow(projectId, {
        sid: 'claude_project-session-2',
        created_at: 9,
        updated_at: 19,
      }),
    )
    env.state.hub_session_discovery.push(
      discoveryRow(),
      discoveryRow({
        sid: 'claude_project-session-2',
        published_at: 9,
        updated_at: 19,
      }),
    )

    const first = await invoke(
      ownerProjectGet,
      getRequest(`/api/owners/${handle}/projects/compiler-work?limit=1`),
      env,
      { handle, slug: 'compiler-work' },
    )
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as Record<string, any>
    expect(firstBody.sessions.map((session: Record<string, unknown>) => session.sid)).toEqual([
      'claude_project-session-1',
    ])
    expect(firstBody.sessions[0]).toMatchObject({ published_at: 10, updated_at: 20 })
    expect(firstBody.project.session_count).toBe(2)
    expect(firstBody.next_cursor).toEqual(expect.any(String))

    const second = await invoke(
      ownerProjectGet,
      getRequest(
        `/api/owners/${handle}/projects/compiler-work?limit=1&cursor=${encodeURIComponent(
          firstBody.next_cursor as string,
        )}`,
      ),
      env,
      { handle, slug: 'compiler-work' },
    )
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toMatchObject({
      project: { id: projectId, session_count: 2 },
      sessions: [{ sid: 'claude_project-session-2', published_at: 9, updated_at: 19 }],
      next_cursor: null,
    })
  })
})

function expectPrivate(response: Response): void {
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('vary')).toContain('Cookie')
  expect(response.headers.get('vary')).toContain('Authorization')
}

function projectRow(args: {
  id: string
  slug: string
  name: string
  ownerUserId: string | null
  ownerTeamId: string | null
  updatedAt: number
  archivedAt?: number | null
}): TestEnv['state']['projects'][number] {
  return {
    id: args.id,
    owner_user_id: args.ownerUserId,
    owner_team_id: args.ownerTeamId,
    slug: args.slug,
    name: args.name,
    description: null,
    github_url: null,
    created_by_user_id: 'user-a',
    created_at: Math.min(1, args.updatedAt),
    updated_at: args.updatedAt,
    archived_at: args.archivedAt ?? null,
  }
}

function seedProjectsToLimit(
  env: TestEnv,
  args: {
    ownerUserId: string | null
    ownerTeamId: string | null
    existing: number
  },
): void {
  for (let index = args.existing; index < MAX_ACTIVE_PROJECTS_PER_TENANT; index += 1) {
    env.state.projects.push(
      projectRow({
        id: `project_quota_${String(index).padStart(3, '0')}`,
        slug: `quota-${String(index).padStart(3, '0')}`,
        name: `Quota ${index}`,
        ownerUserId: args.ownerUserId,
        ownerTeamId: args.ownerTeamId,
        updatedAt: index + 1,
      }),
    )
  }
}

function sessionRow(
  projectId: string,
  overrides: Partial<TestEnv['state']['hub_sessions'][number]> = {},
): TestEnv['state']['hub_sessions'][number] {
  return {
    sid: 'claude_project-session-1',
    owner_user_id: 'user-a',
    root: 'a'.repeat(64),
    record_count: 2,
    sig: null,
    card_json: JSON.stringify({ title: 'Project Session' }),
    note_md: 'Background and completed outcome.',
    lineage_json: null,
    view_oid: 'b'.repeat(64),
    spool_file_oid: null,
    cost_usd: 0.25,
    total_tokens: 1_000,
    visibility: 'unlisted',
    team_id: null,
    project_id: projectId,
    withdrawn_at: null,
    created_at: 10,
    updated_at: 20,
    ...overrides,
  }
}

function discoveryRow(
  overrides: Partial<TestEnv['state']['hub_session_discovery'][number]> = {},
): TestEnv['state']['hub_session_discovery'][number] {
  return {
    sid: 'claude_project-session-1',
    agent: 'claude',
    title: 'Project Session',
    title_json: null,
    cost_usd: 0.25,
    total_tokens: 1_000,
    summary_text: 'Background and completed outcome.',
    summary_text_zh: null,
    search_text: 'project session',
    message_count: 2,
    tool_call_count: 1,
    file_count: 1,
    additions: 3,
    deletions: 1,
    lineage_source_sid: null,
    quality_score: 1,
    published_at: 10,
    updated_at: 20,
    ...overrides,
  }
}

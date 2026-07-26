import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { ApiError } from '../errors'
import { ensureOwnerHandle } from '../handles'
import {
  managedSessionJoins,
  managedSessionProjection,
  type HydratedManagedSessionRow,
} from '../hub/managed-row'
import { resolveDisplayName } from '../profile/display-name'
import {
  DEFAULT_PROJECT_LIST_LIMIT,
  MAX_ACTIVE_PROJECTS_PER_TENANT,
  MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR,
  MAX_PROJECT_LIST_LIMIT,
  MAX_PROJECTS_PER_TENANT,
} from './limits'
import { HUB_PROJECTS_LIST_SQL } from './query-sql'
import type { ProjectOwner, ProjectResponse, ProjectRow, ProjectTenant } from './types'
import type { CreateProjectInput, UpdateProjectInput } from './validators'

export type ProjectWithCount = ProjectRow & { session_count: number; star_count?: number }

export type HubProjectRow = ProjectWithCount & {
  owner_handle: string
  owner_name: string
  owner_avatar_url: string | null
  owner_custom_avatar_id: string | null
  owner_avatar_visible: number
  can_manage: number
}

export type PublicProjectRow = ProjectRow & {
  session_count: number
  last_session_at: number
  star_count: number
  owner_handle: string
  owner_email: string | null
  owner_name: string | null
  owner_display_name: string | null
  owner_avatar_url: string | null
  owner_custom_avatar_id: string | null
  owner_avatar_visible: number
}

export type PublicProjectCursor = { lastSessionAt: number; id: string }

export type ProjectListPageOptions = {
  after: { updatedAt: number; id: string } | null
  fingerprint: string
  limit: number
}

export type ProjectListPage<Row> = {
  rows: Row[]
  nextCursor: string | null
}

export type ProjectSessionPageOptions = {
  after: { sortAt: number; sid: string } | null
  fingerprint: string
  limit: number
}

export type ProjectSessionPage<Row> = {
  rows: Row[]
  nextCursor: string | null
}

export type PublicProjectSessionSnapshot<Row> = ProjectSessionPage<Row> & {
  owner: ResolvedHandleOwner
  project: ProjectWithCount
}

const DEFAULT_PROJECT_SESSION_LIMIT = 20
const MAX_PROJECT_SESSION_LIMIT = 50
const PROJECT_SESSION_CURSOR_VERSION = 1
const PROJECT_LIST_CURSOR_VERSION = 1

export async function parseProjectListPageOptions(
  request: Request,
  scope: readonly string[],
): Promise<ProjectListPageOptions> {
  const url = new URL(request.url)
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    throw new ApiError('BAD_REQUEST', 'cursor and limit may be provided at most once')
  }
  const limitValue = url.searchParams.get('limit')
  let limit = DEFAULT_PROJECT_LIST_LIMIT
  if (limitValue !== null) {
    if (!/^\d+$/.test(limitValue)) {
      throw new ApiError(
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_PROJECT_LIST_LIMIT}`,
      )
    }
    limit = Number(limitValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PROJECT_LIST_LIMIT) {
      throw new ApiError(
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_PROJECT_LIST_LIMIT}`,
      )
    }
  }
  const fingerprint = base64urlFromBuffer(await sha256(JSON.stringify(scope))).slice(0, 16)
  const cursor = url.searchParams.get('cursor')
  return {
    after: cursor === null ? null : decodeProjectListCursor(cursor, fingerprint),
    fingerprint,
    limit,
  }
}

export function fullTenantProjectListOptions(): ProjectListPageOptions {
  return {
    after: null,
    fingerprint: '',
    limit: MAX_ACTIVE_PROJECTS_PER_TENANT,
  }
}

export async function parseProjectSessionPageOptions(
  request: Request,
  scope: readonly string[],
): Promise<ProjectSessionPageOptions> {
  const url = new URL(request.url)
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    throw new ApiError('BAD_REQUEST', 'cursor and limit may be provided at most once')
  }
  const limitValue = url.searchParams.get('limit')
  let limit = DEFAULT_PROJECT_SESSION_LIMIT
  if (limitValue !== null) {
    if (!/^\d+$/.test(limitValue)) {
      throw new ApiError(
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_PROJECT_SESSION_LIMIT}`,
      )
    }
    limit = Number(limitValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PROJECT_SESSION_LIMIT) {
      throw new ApiError(
        'BAD_REQUEST',
        `limit must be an integer from 1 to ${MAX_PROJECT_SESSION_LIMIT}`,
      )
    }
  }
  const fingerprint = base64urlFromBuffer(await sha256(JSON.stringify(scope))).slice(0, 16)
  const cursor = url.searchParams.get('cursor')
  return {
    after: cursor === null ? null : decodeProjectSessionCursor(cursor, fingerprint),
    fingerprint,
    limit,
  }
}

export type ResolvedHandleOwner =
  | {
      kind: 'user'
      id: string
      handle: string
      name: string
      avatar_url: string | null
    }
  | {
      kind: 'team'
      id: string
      handle: string
      name: string
      avatar_url: null
    }

export function defaultProjectId(tenant: ProjectTenant): string {
  return tenant.teamId === null
    ? `project_default_user_${tenant.userId}`
    : `project_default_team_${tenant.teamId}`
}

export function ensureProjectTenantHandle(
  db: D1Database,
  args: { actorUserId: string; tenant: ProjectTenant; label?: string; now: number },
): Promise<string> {
  return args.tenant.teamId === null
    ? ensureOwnerHandle(db, {
        actorUserId: args.actorUserId,
        userId: args.tenant.userId,
        teamId: null,
        ...(args.label === undefined ? {} : { label: args.label }),
        now: args.now,
      })
    : ensureOwnerHandle(db, {
        actorUserId: args.actorUserId,
        userId: null,
        teamId: args.tenant.teamId,
        ...(args.label === undefined ? {} : { label: args.label }),
        now: args.now,
      })
}

export async function activeProjectForTenant(
  db: D1Database,
  projectId: string,
  tenant: ProjectTenant,
): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT * FROM projects
       WHERE id=? AND owner_user_id IS ? AND owner_team_id IS ?
         AND archived_at IS NULL`,
    )
    .bind(projectId, tenant.userId, tenant.teamId)
    .first<ProjectRow>()
}

export async function resolveDefaultProject(
  db: D1Database,
  tenant: ProjectTenant,
): Promise<{ projectId: string; needsInsert: boolean }> {
  const id = defaultProjectId(tenant)
  const row = await db
    .prepare(
      `SELECT id FROM projects
       WHERE owner_user_id IS ? AND owner_team_id IS ?
         AND archived_at IS NULL
         AND (id=? OR slug='sessions')
       ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END, created_at ASC, id ASC
       LIMIT 1`,
    )
    .bind(tenant.userId, tenant.teamId, id, id)
    .first<{ id: string }>()
  return row ? { projectId: row.id, needsInsert: false } : { projectId: id, needsInsert: true }
}

export function prepareAuthorizedDefaultProjectInsert(
  db: D1Database,
  args: { actorUserId: string; tenant: ProjectTenant; now: number },
): D1PreparedStatement {
  const id = defaultProjectId(args.tenant)
  return db
    .prepare(
      `/* projects:authorized-default */
       INSERT INTO projects
         (id, owner_user_id, owner_team_id, slug, name, description, github_url,
          created_by_user_id, created_at, updated_at, archived_at)
       SELECT ?,?,?,'sessions','Sessions',
         'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
         NULL,?,?,?,NULL
       WHERE EXISTS (
         SELECT 1 FROM users actor
         WHERE actor.id=? AND actor.deleted_at IS NULL
           AND actor.deletion_pending_until IS NULL
       )
       AND (
         (? IS NULL AND ?=?)
         OR
         (? IS NOT NULL AND EXISTS (
           SELECT 1
           FROM teams t
           JOIN team_memberships m ON m.team_id=t.id
           WHERE t.id=? AND t.archived_at IS NULL
             AND t.deletion_pending_until IS NULL
             AND m.user_id=?
         ))
       )
       AND EXISTS (
         SELECT 1 FROM handles owner_handle
         WHERE owner_handle.released_at IS NULL
           AND owner_handle.user_id IS ? AND owner_handle.team_id IS ?
       )
       AND (
         SELECT COUNT(*)
         FROM projects active_project
         WHERE active_project.owner_user_id IS ?
           AND active_project.owner_team_id IS ?
           AND active_project.archived_at IS NULL
       ) < ?
       AND (
         SELECT COUNT(*)
         FROM projects tenant_project
         WHERE tenant_project.owner_user_id IS ?
           AND tenant_project.owner_team_id IS ?
       ) < ?
       ON CONFLICT(id) DO NOTHING`,
    )
    .bind(
      id,
      args.tenant.userId,
      args.tenant.teamId,
      args.actorUserId,
      args.now,
      args.now,
      args.actorUserId,
      args.tenant.teamId,
      args.tenant.userId,
      args.actorUserId,
      args.tenant.teamId,
      args.tenant.teamId,
      args.actorUserId,
      args.tenant.userId,
      args.tenant.teamId,
      args.tenant.userId,
      args.tenant.teamId,
      MAX_ACTIVE_PROJECTS_PER_TENANT,
      args.tenant.userId,
      args.tenant.teamId,
      MAX_PROJECTS_PER_TENANT,
    )
}

export async function getProjectById(
  db: D1Database,
  projectId: string,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT * FROM projects WHERE id=?${options.includeArchived ? '' : ' AND archived_at IS NULL'}`,
    )
    .bind(projectId)
    .first<ProjectRow>()
}

export async function getPersonalProject(
  db: D1Database,
  projectId: string,
  userId: string,
): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT * FROM projects
       WHERE id=? AND owner_user_id=? AND owner_team_id IS NULL
         AND archived_at IS NULL`,
    )
    .bind(projectId, userId)
    .first<ProjectRow>()
}

export async function getTeamProject(
  db: D1Database,
  projectId: string,
  teamId: string,
): Promise<ProjectRow | null> {
  return db
    .prepare(
      `SELECT * FROM projects
       WHERE id=? AND owner_team_id=? AND owner_user_id IS NULL
         AND archived_at IS NULL`,
    )
    .bind(projectId, teamId)
    .first<ProjectRow>()
}

export async function getProjectBySlugForOwner(
  db: D1Database,
  owner: ResolvedHandleOwner,
  slug: string,
): Promise<ProjectRow | null> {
  const column = owner.kind === 'user' ? 'owner_user_id' : 'owner_team_id'
  return db
    .prepare(`SELECT * FROM projects WHERE ${column}=? AND slug=? AND archived_at IS NULL`)
    .bind(owner.id, slug)
    .first<ProjectRow>()
}

export async function listPersonalProjects(
  db: D1Database,
  userId: string,
  options: ProjectListPageOptions,
): Promise<ProjectListPage<ProjectWithCount>> {
  const rows = await db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM hub_sessions s
          WHERE s.project_id=p.id AND s.withdrawn_at IS NULL) AS session_count,
         (SELECT COUNT(*) FROM project_stars relation
          JOIN users star_user ON star_user.id=relation.user_id
            AND star_user.deleted_at IS NULL
            AND star_user.deletion_pending_until IS NULL
          WHERE relation.project_id=p.id) AS star_count
       FROM projects p
       JOIN users owner ON owner.id=p.owner_user_id
       WHERE p.owner_user_id=? AND p.owner_team_id IS NULL
         AND p.archived_at IS NULL
         AND owner.deleted_at IS NULL AND owner.deletion_pending_until IS NULL
         AND (
           ?=0 OR p.updated_at<? OR (p.updated_at=? AND p.id>?)
         )
       ORDER BY p.updated_at DESC, p.id ASC
       LIMIT ?`,
    )
    .bind(
      userId,
      options.after === null ? 0 : 1,
      options.after?.updatedAt ?? 0,
      options.after?.updatedAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<ProjectWithCount>()
  return finishProjectListPage(rows.results, options)
}

export async function listHubProjectsForUser(
  db: D1Database,
  userId: string,
  options: ProjectListPageOptions,
): Promise<ProjectListPage<HubProjectRow>> {
  const rows = await db
    .prepare(HUB_PROJECTS_LIST_SQL)
    .bind(
      userId,
      options.after === null ? 0 : 1,
      options.after?.updatedAt ?? 0,
      options.after?.updatedAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<HubProjectRow>()
  return finishProjectListPage(rows.results, options)
}

export function serializeHubProject(row: HubProjectRow): ProjectResponse {
  const ownerUserId = row.owner_user_id
  const ownerTeamId = row.owner_team_id
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    github_url: row.github_url,
    owner: {
      kind: ownerTeamId === null ? 'user' : 'team',
      id: ownerTeamId ?? ownerUserId!,
      handle: row.owner_handle,
      name: row.owner_name,
      avatar_url:
        ownerUserId === null
          ? null
          : visibleUserAvatarUrl({
              userId: ownerUserId,
              avatarUrl: row.owner_avatar_url,
              customAvatarId: row.owner_custom_avatar_id,
              avatarVisible: row.owner_avatar_visible,
            }),
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    session_count: Math.max(0, Number(row.session_count)),
    star_count: Math.max(0, Number(row.star_count ?? 0)),
    can_manage: row.can_manage === 1,
  }
}

export async function listTeamProjects(
  db: D1Database,
  teamId: string,
  actorUserId: string,
  options: ProjectListPageOptions,
): Promise<ProjectListPage<ProjectWithCount> | null> {
  const rows = await db
    .prepare(
      `/* projects:list-team-authorized */
       WITH current_team AS (
         SELECT t.id
         FROM teams t
         JOIN team_memberships m ON m.team_id=t.id
         JOIN users actor ON actor.id=m.user_id
         WHERE t.id=? AND m.user_id=?
           AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
           AND actor.deleted_at IS NULL AND actor.deletion_pending_until IS NULL
       )
       SELECT p.*,
         (SELECT COUNT(*) FROM hub_sessions s
          WHERE s.project_id=p.id AND s.withdrawn_at IS NULL) AS session_count,
         (SELECT COUNT(*) FROM project_stars relation
          JOIN users star_user ON star_user.id=relation.user_id
            AND star_user.deleted_at IS NULL
            AND star_user.deletion_pending_until IS NULL
          WHERE relation.project_id=p.id) AS star_count
       FROM current_team
       LEFT JOIN projects p
         ON p.owner_team_id=current_team.id AND p.owner_user_id IS NULL
        AND p.archived_at IS NULL
        AND (
          ?=0 OR p.updated_at<? OR (p.updated_at=? AND p.id>?)
        )
       ORDER BY p.updated_at DESC, p.id ASC
       LIMIT ?`,
    )
    .bind(
      teamId,
      actorUserId,
      options.after === null ? 0 : 1,
      options.after?.updatedAt ?? 0,
      options.after?.updatedAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<
      { [K in keyof ProjectRow]: ProjectRow[K] | null } & {
        session_count: number | null
      }
    >()
  if (rows.results.length === 0) return null
  return finishProjectListPage(
    rows.results.filter((row) => row.id !== null).map((row) => row as ProjectWithCount),
    options,
  )
}

export async function resolveHandleOwner(
  db: D1Database,
  handle: string,
): Promise<ResolvedHandleOwner | null> {
  const row = await db
    .prepare(
      `SELECT h.handle, h.user_id, h.team_id,
         CASE
           WHEN h.user_id IS NOT NULL THEN NULL
           ELSE t.name
         END AS owner_name,
         u.email AS owner_email,
         u.name AS owner_provider_name,
         u.display_name AS owner_display_name,
         u.avatar_url AS owner_avatar_url,
         u.custom_avatar_id AS owner_custom_avatar_id,
         u.avatar_visible AS owner_avatar_visible
       FROM handles h
       LEFT JOIN users u ON u.id=h.user_id
         AND u.deleted_at IS NULL AND u.deletion_pending_until IS NULL
       LEFT JOIN teams t ON t.id=h.team_id
         AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
       WHERE h.handle=? AND h.released_at IS NULL
         AND ((h.user_id IS NOT NULL AND u.id IS NOT NULL)
           OR (h.team_id IS NOT NULL AND t.id IS NOT NULL))`,
    )
    .bind(handle)
    .first<{
      handle: string
      user_id: string | null
      team_id: string | null
      owner_name: string | null
      owner_email: string | null
      owner_provider_name: string | null
      owner_display_name: string | null
      owner_avatar_url: string | null
      owner_custom_avatar_id: string | null
      owner_avatar_visible: number | null
    }>()
  if (!row) return null
  if (row.team_id !== null) {
    return {
      kind: 'team',
      id: row.team_id,
      handle: row.handle,
      name: row.owner_name ?? row.handle,
      avatar_url: null,
    }
  }
  if (row.user_id === null || row.owner_email === null) return null
  return {
    kind: 'user',
    id: row.user_id,
    handle: row.handle,
    name: resolveDisplayName({
      display_name: row.owner_display_name,
      name: row.owner_provider_name,
      email: row.owner_email,
    }),
    avatar_url: visibleUserAvatarUrl({
      userId: row.user_id,
      avatarUrl: row.owner_avatar_url,
      customAvatarId: row.owner_custom_avatar_id,
      avatarVisible: row.owner_avatar_visible,
    }),
  }
}

export async function projectOwner(db: D1Database, row: ProjectRow): Promise<ProjectOwner> {
  if (row.owner_team_id !== null) {
    const owner = await db
      .prepare(
        `SELECT t.name,
           (SELECT handle FROM handles
            WHERE team_id=t.id AND released_at IS NULL LIMIT 1) AS handle
         FROM teams t
         WHERE t.id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL`,
      )
      .bind(row.owner_team_id)
      .first<{ name: string; handle: string | null }>()
    if (!owner || owner.handle === null)
      throw new ApiError('INTERNAL', 'Project owner handle missing')
    return {
      kind: 'team',
      id: row.owner_team_id,
      handle: owner.handle,
      name: owner.name,
      avatar_url: null,
    }
  }

  const owner = await db
    .prepare(
      `SELECT u.email, u.name, u.display_name, u.avatar_url,
         u.custom_avatar_id, u.avatar_visible,
         (SELECT handle FROM handles
          WHERE user_id=u.id AND released_at IS NULL LIMIT 1) AS handle
       FROM users u
       WHERE u.id=? AND u.deleted_at IS NULL
         AND u.deletion_pending_until IS NULL`,
    )
    .bind(row.owner_user_id)
    .first<{
      email: string
      name: string | null
      display_name: string | null
      avatar_url: string | null
      custom_avatar_id: string | null
      avatar_visible: number | null
      handle: string | null
    }>()
  if (!owner || owner.handle === null || row.owner_user_id === null) {
    throw new ApiError('INTERNAL', 'Project owner handle missing')
  }
  return {
    kind: 'user',
    id: row.owner_user_id,
    handle: owner.handle,
    name: resolveDisplayName(owner),
    avatar_url: visibleUserAvatarUrl({
      userId: row.owner_user_id,
      avatarUrl: owner.avatar_url,
      customAvatarId: owner.custom_avatar_id,
      avatarVisible: owner.avatar_visible,
    }),
  }
}

function visibleUserAvatarUrl(args: {
  userId: string
  avatarUrl: string | null
  customAvatarId: string | null
  avatarVisible: number | null
}): string | null {
  if ((args.avatarVisible ?? 1) !== 1) return null
  return args.customAvatarId
    ? `/api/avatars/${encodeURIComponent(args.userId)}?v=${encodeURIComponent(args.customAvatarId)}`
    : args.avatarUrl
}

export async function serializeProject(
  db: D1Database,
  row: ProjectRow & { session_count?: number },
  options: { canManage?: boolean } = {},
): Promise<ProjectResponse> {
  const sessionCount =
    row.session_count === undefined
      ? await db
          .prepare(
            `SELECT COUNT(*) AS count
             FROM hub_sessions
             WHERE project_id=? AND withdrawn_at IS NULL`,
          )
          .bind(row.id)
          .first<{ count: number }>()
      : { count: row.session_count }
  return serializeProjectWithOwner(
    {
      ...row,
      session_count: Math.max(0, Number(sessionCount?.count ?? 0)),
    },
    await projectOwner(db, row),
    options,
  )
}

export function serializeProjectWithOwner(
  row: ProjectWithCount,
  owner: ProjectOwner,
  options: { canManage?: boolean } = {},
): ProjectResponse {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    github_url: row.github_url,
    owner,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at,
    session_count: Math.max(0, Number(row.session_count)),
    star_count: Math.max(0, Number(row.star_count ?? 0)),
    can_manage: options.canManage ?? false,
  }
}

export function serializePublicProject(row: PublicProjectRow): ProjectResponse {
  if (row.owner_team_id !== null) {
    return serializeProjectWithOwner(
      row,
      {
        kind: 'team',
        id: row.owner_team_id,
        handle: row.owner_handle,
        name: row.owner_name ?? row.owner_handle,
        avatar_url: null,
      },
      { canManage: false },
    )
  }
  if (row.owner_user_id === null || row.owner_email === null) {
    throw new ApiError('INTERNAL', 'Public Project owner missing')
  }
  return serializeProjectWithOwner(
    row,
    {
      kind: 'user',
      id: row.owner_user_id,
      handle: row.owner_handle,
      name: resolveDisplayName({
        email: row.owner_email,
        name: row.owner_name,
        display_name: row.owner_display_name,
      }),
      avatar_url: visibleUserAvatarUrl({
        userId: row.owner_user_id,
        avatarUrl: row.owner_avatar_url,
        customAvatarId: row.owner_custom_avatar_id,
        avatarVisible: row.owner_avatar_visible,
      }),
    },
    { canManage: false },
  )
}

export async function createProject(
  db: D1Database,
  args: {
    id: string
    actorUserId: string
    tenant: ProjectTenant
    input: CreateProjectInput
    now: number
  },
): Promise<ProjectRow> {
  const result = await prepareAuthorizedProjectInsert(db, args).run()
  if ((result.meta.changes ?? 0) === 0) {
    if ((await countActiveProjectsForTenant(db, args.tenant)) >= MAX_ACTIVE_PROJECTS_PER_TENANT) {
      throw new ApiError(
        'CONFLICT',
        `active Project limit reached (${MAX_ACTIVE_PROJECTS_PER_TENANT})`,
      )
    }
    if ((await countProjectsForTenant(db, args.tenant)) >= MAX_PROJECTS_PER_TENANT) {
      throw new ApiError('CONFLICT', `Project history limit reached (${MAX_PROJECTS_PER_TENANT})`)
    }
    throw new ApiError('NOT_FOUND')
  }
  const created = await getProjectById(db, args.id)
  if (!created) throw new ApiError('INTERNAL', 'Project create failed')
  return created
}

export async function createProjectIdempotently(
  db: D1Database,
  args: {
    actorUserId: string
    tenant: ProjectTenant
    input: CreateProjectInput
    idempotencyKey: string
    now: number
  },
): Promise<{ project: ProjectRow; replayed: boolean }> {
  const tenantKey =
    args.tenant.teamId === null ? `user:${args.tenant.userId}` : `team:${args.tenant.teamId}`
  const requestHash = await projectCreateHash(JSON.stringify({ input: args.input, tenantKey }))
  const projectId = `project_${(
    await projectCreateHash(JSON.stringify([args.actorUserId, tenantKey, args.idempotencyKey]))
  ).slice(0, 32)}`
  const priorRequest = await getProjectCreationRequest(
    db,
    args.actorUserId,
    tenantKey,
    args.idempotencyKey,
  )
  if (priorRequest) {
    if (priorRequest.request_hash !== requestHash) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Project')
    }
    const priorProject = await getProjectById(db, priorRequest.project_id, {
      includeArchived: true,
    })
    if (!priorProject) throw new ApiError('INTERNAL', 'Project create receipt is incomplete')
    return { project: priorProject, replayed: true }
  }

  const existing = await getProjectById(db, projectId, { includeArchived: true })
  if (existing) {
    if (
      existing.owner_user_id !== args.tenant.userId ||
      existing.owner_team_id !== args.tenant.teamId ||
      existing.slug !== args.input.slug ||
      existing.name !== args.input.name ||
      existing.description !== args.input.description ||
      existing.github_url !== args.input.github_url
    ) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Project')
    }
    return { project: existing, replayed: true }
  }

  try {
    const results = await db.batch([
      prepareAuthorizedProjectInsert(db, {
        id: projectId,
        actorUserId: args.actorUserId,
        tenant: args.tenant,
        input: args.input,
        now: args.now,
        receiptActorUserId: args.actorUserId,
      }),
      db
        .prepare(
          `/* projects:record-idempotent-create */
           INSERT INTO project_creation_requests
             (actor_user_id, owner_scope, owner_user_id, owner_team_id,
              idempotency_key, project_id, request_hash, created_at)
           SELECT ?,?,?,?,?,?,?,?
           WHERE EXISTS (
             SELECT 1 FROM projects project
             WHERE project.id=? AND project.owner_user_id IS ?
               AND project.owner_team_id IS ?
           )
           AND (
             SELECT COUNT(*)
             FROM project_creation_requests actor_receipt
             WHERE actor_receipt.actor_user_id=?
           ) < ?`,
        )
        .bind(
          args.actorUserId,
          tenantKey,
          args.tenant.userId,
          args.tenant.teamId,
          args.idempotencyKey,
          projectId,
          requestHash,
          args.now,
          projectId,
          args.tenant.userId,
          args.tenant.teamId,
          args.actorUserId,
          MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR,
        ),
    ])
    if ((results[0]?.meta.changes ?? 0) === 0 || (results[1]?.meta.changes ?? 0) === 0) {
      if ((await countActiveProjectsForTenant(db, args.tenant)) >= MAX_ACTIVE_PROJECTS_PER_TENANT) {
        throw new ApiError(
          'CONFLICT',
          `active Project limit reached (${MAX_ACTIVE_PROJECTS_PER_TENANT})`,
        )
      }
      if ((await countProjectsForTenant(db, args.tenant)) >= MAX_PROJECTS_PER_TENANT) {
        throw new ApiError('CONFLICT', `Project history limit reached (${MAX_PROJECTS_PER_TENANT})`)
      }
      if (
        (await countProjectCreationReceiptsForActor(db, args.actorUserId)) >=
        MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR
      ) {
        throw new ApiError(
          'CONFLICT',
          `Project creation receipt limit reached (${MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR})`,
        )
      }
      throw new ApiError('NOT_FOUND')
    }
  } catch (error) {
    // D1 batches are atomic. A concurrent identical request can win both the
    // Project and receipt constraints; recover only after reading the durable
    // receipt, never from a half-written Project.
    const won = await getProjectCreationRequest(
      db,
      args.actorUserId,
      tenantKey,
      args.idempotencyKey,
    )
    if (won?.request_hash === requestHash) {
      const wonProject = await getProjectById(db, won.project_id, {
        includeArchived: true,
      })
      if (wonProject) return { project: wonProject, replayed: true }
    }
    if (won) {
      throw new ApiError('CONFLICT', 'Idempotency-Key was already used for another Project')
    }
    if (isProjectConstraintError(error)) {
      throw new ApiError('CONFLICT', 'Project slug is already in use')
    }
    throw error
  }

  const created = await getProjectById(db, projectId)
  if (!created) throw new ApiError('INTERNAL', 'Project create failed')
  return { project: created, replayed: false }
}

type ProjectCreationRequest = { project_id: string; request_hash: string }

async function getProjectCreationRequest(
  db: D1Database,
  actorUserId: string,
  ownerScope: string,
  idempotencyKey: string,
): Promise<ProjectCreationRequest | null> {
  return db
    .prepare(
      `SELECT project_id, request_hash
       FROM project_creation_requests
       WHERE actor_user_id=? AND owner_scope=? AND idempotency_key=?`,
    )
    .bind(actorUserId, ownerScope, idempotencyKey)
    .first<ProjectCreationRequest>()
}

async function projectCreateHash(value: string): Promise<string> {
  const digest = new Uint8Array(await sha256(value))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function prepareAuthorizedProjectInsert(
  db: D1Database,
  args: {
    id: string
    actorUserId: string
    tenant: ProjectTenant
    input: CreateProjectInput
    now: number
    receiptActorUserId?: string
  },
): D1PreparedStatement {
  const teamId = args.tenant.teamId
  const ownerUserId = args.tenant.userId
  return db
    .prepare(
      `/* projects:authorized-create */
       INSERT INTO projects
         (id, owner_user_id, owner_team_id, slug, name, description, github_url,
          created_by_user_id, created_at, updated_at, archived_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,NULL
       WHERE EXISTS (
         SELECT 1 FROM users actor
         WHERE actor.id=? AND actor.deleted_at IS NULL
           AND actor.deletion_pending_until IS NULL
       )
       AND (
         (? IS NULL AND ?=?)
         OR
         (? IS NOT NULL AND EXISTS (
           SELECT 1
           FROM teams t
           JOIN team_memberships m ON m.team_id=t.id
           WHERE t.id=? AND t.archived_at IS NULL
             AND t.deletion_pending_until IS NULL
             AND m.user_id=? AND m.role IN ('owner','admin')
         ))
       )
       AND EXISTS (
         SELECT 1 FROM handles owner_handle
         WHERE owner_handle.released_at IS NULL
           AND owner_handle.user_id IS ? AND owner_handle.team_id IS ?
       )
       AND (
         SELECT COUNT(*)
         FROM projects active_project
         WHERE active_project.owner_user_id IS ?
           AND active_project.owner_team_id IS ?
           AND active_project.archived_at IS NULL
       ) < ?
       AND (
         SELECT COUNT(*)
         FROM projects tenant_project
         WHERE tenant_project.owner_user_id IS ?
           AND tenant_project.owner_team_id IS ?
       ) < ?
       AND (
         ? IS NULL OR (
           SELECT COUNT(*)
           FROM project_creation_requests actor_receipt
           WHERE actor_receipt.actor_user_id=?
         ) < ?
       )`,
    )
    .bind(
      args.id,
      ownerUserId,
      teamId,
      args.input.slug,
      args.input.name,
      args.input.description,
      args.input.github_url,
      args.actorUserId,
      args.now,
      args.now,
      args.actorUserId,
      teamId,
      ownerUserId,
      args.actorUserId,
      teamId,
      teamId,
      args.actorUserId,
      ownerUserId,
      teamId,
      ownerUserId,
      teamId,
      MAX_ACTIVE_PROJECTS_PER_TENANT,
      ownerUserId,
      teamId,
      MAX_PROJECTS_PER_TENANT,
      args.receiptActorUserId ?? null,
      args.receiptActorUserId ?? '',
      MAX_PROJECT_CREATION_RECEIPTS_PER_ACTOR,
    )
}

export async function countActiveProjectsForTenant(
  db: D1Database,
  tenant: ProjectTenant,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM projects
       WHERE owner_user_id IS ? AND owner_team_id IS ?
         AND archived_at IS NULL`,
    )
    .bind(tenant.userId, tenant.teamId)
    .first<{ count: number }>()
  return Math.max(0, Number(row?.count ?? 0))
}

export async function countProjectsForTenant(
  db: D1Database,
  tenant: ProjectTenant,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM projects
       WHERE owner_user_id IS ? AND owner_team_id IS ?`,
    )
    .bind(tenant.userId, tenant.teamId)
    .first<{ count: number }>()
  return Math.max(0, Number(row?.count ?? 0))
}

export async function countProjectCreationReceiptsForActor(
  db: D1Database,
  actorUserId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM project_creation_requests
       WHERE actor_user_id=?`,
    )
    .bind(actorUserId)
    .first<{ count: number }>()
  return Math.max(0, Number(row?.count ?? 0))
}

export async function updateProject(
  db: D1Database,
  args: {
    projectId: string
    actorUserId: string
    tenant: ProjectTenant
    input: UpdateProjectInput
    now: number
  },
): Promise<ProjectRow> {
  const input = args.input
  const result = await db
    .prepare(
      `/* projects:authorized-update */
       UPDATE projects
       SET name=CASE WHEN ?=1 THEN ? ELSE name END,
           slug=CASE WHEN ?=1 THEN ? ELSE slug END,
           description=CASE WHEN ?=1 THEN ? ELSE description END,
           github_url=CASE WHEN ?=1 THEN ? ELSE github_url END,
           archived_at=CASE WHEN ?=1 THEN CASE WHEN ?=1 THEN ? ELSE NULL END
                            ELSE archived_at END,
           updated_at=?
       WHERE id=?
         AND owner_user_id IS ? AND owner_team_id IS ?
         AND (?=0 OR updated_at=?)
         AND (
           ?=0
           OR NOT EXISTS (
             SELECT 1 FROM hub_sessions linked_session
             WHERE linked_session.project_id=projects.id
               AND linked_session.withdrawn_at IS NULL
           )
         )
         AND (
           ?=0 OR NOT (projects.id=? OR projects.slug='sessions')
         )
         AND EXISTS (
           SELECT 1 FROM users actor
           WHERE actor.id=? AND actor.deleted_at IS NULL
             AND actor.deletion_pending_until IS NULL
         )
         AND (
           (? IS NULL AND owner_user_id=?)
           OR
           (? IS NOT NULL AND EXISTS (
             SELECT 1
             FROM teams t
             JOIN team_memberships m ON m.team_id=t.id
             WHERE t.id=? AND t.archived_at IS NULL
               AND t.deletion_pending_until IS NULL
               AND m.user_id=? AND m.role IN ('owner','admin')
           ))
         )`,
    )
    .bind(
      input.name === undefined ? 0 : 1,
      input.name ?? '',
      input.slug === undefined ? 0 : 1,
      input.slug ?? '',
      input.description === undefined ? 0 : 1,
      input.description ?? null,
      input.github_url === undefined ? 0 : 1,
      input.github_url ?? null,
      input.archived === undefined ? 0 : 1,
      input.archived ? 1 : 0,
      args.now,
      args.now,
      args.projectId,
      args.tenant.userId,
      args.tenant.teamId,
      input.expected_updated_at === undefined ? 0 : 1,
      input.expected_updated_at ?? 0,
      input.archived === true ? 1 : 0,
      input.archived === true ? 1 : 0,
      defaultProjectId(args.tenant),
      args.actorUserId,
      args.tenant.teamId,
      args.actorUserId,
      args.tenant.teamId,
      args.tenant.teamId,
      args.actorUserId,
    )
    .run()
  if ((result.meta.changes ?? 0) === 0) {
    if (input.archived === true) {
      const fallbackProject = await db
        .prepare(
          `SELECT 1 FROM projects
           WHERE id=? AND owner_user_id IS ? AND owner_team_id IS ?
             AND archived_at IS NULL
             AND (id=? OR slug='sessions')
           LIMIT 1`,
        )
        .bind(args.projectId, args.tenant.userId, args.tenant.teamId, defaultProjectId(args.tenant))
        .first()
      if (fallbackProject) {
        throw new ApiError('CONFLICT', 'Default Project cannot be archived')
      }
      const linkedSession = await db
        .prepare('SELECT 1 FROM hub_sessions WHERE project_id=? AND withdrawn_at IS NULL LIMIT 1')
        .bind(args.projectId)
        .first()
      if (linkedSession) {
        throw new ApiError('CONFLICT', 'Move its Sessions before archiving')
      }
    }
    throw new ApiError('CONFLICT', 'Project changed')
  }
  const updated = await getProjectById(db, args.projectId, { includeArchived: true })
  if (!updated) throw new ApiError('NOT_FOUND')
  return updated
}

export async function listProjectSessions(
  db: D1Database,
  projectId: string,
  scope: { kind: 'personal'; userId: string } | { kind: 'team'; teamId: string; userId: string },
  options: ProjectSessionPageOptions,
): Promise<
  ProjectSessionPage<
    HydratedManagedSessionRow & {
      team_name: string | null
      star_count: number
      project_sort_at: number
    }
  >
> {
  const teamId = scope.kind === 'team' ? scope.teamId : null
  const rows = await db
    .prepare(
      `/* projects:list-sessions-authorized */
       SELECT s.*, s.updated_at AS project_sort_at, t.name AS team_name,
         (SELECT COUNT(*) FROM hub_session_stars star WHERE star.sid=s.sid) AS star_count,
         ${managedSessionProjection()}
       FROM projects p
       JOIN hub_sessions s ON s.project_id=p.id
       ${managedSessionJoins('s')}
       LEFT JOIN teams t ON t.id=s.team_id
       WHERE p.id=? AND p.archived_at IS NULL
         AND s.withdrawn_at IS NULL
         AND p.owner_user_id IS ? AND p.owner_team_id IS ?
         AND (
           (? IS NULL AND p.owner_user_id=?)
           OR
           (? IS NOT NULL AND EXISTS (
             SELECT 1 FROM teams gated_team
             JOIN team_memberships member ON member.team_id=gated_team.id
             WHERE gated_team.id=? AND gated_team.archived_at IS NULL
               AND gated_team.deletion_pending_until IS NULL
               AND member.user_id=?
           ))
         )
       AND (
         ?=0 OR s.updated_at<? OR (s.updated_at=? AND s.sid>?)
       )
       ORDER BY s.updated_at DESC, s.sid ASC
       LIMIT ?`,
    )
    .bind(
      projectId,
      scope.kind === 'personal' ? scope.userId : null,
      teamId,
      teamId,
      scope.userId,
      teamId,
      teamId,
      scope.userId,
      options.after === null ? 0 : 1,
      options.after?.sortAt ?? 0,
      options.after?.sortAt ?? 0,
      options.after?.sid ?? '',
      options.limit + 1,
    )
    .all<
      HydratedManagedSessionRow & {
        team_name: string | null
        star_count: number
        project_sort_at: number
      }
    >()
  return finishProjectSessionPage(rows.results, options)
}

type PublicProjectSessionRow = HydratedManagedSessionRow & {
  team_name: string | null
  star_count: number
  project_sort_at: number
}

type PublicProjectSnapshotColumns = {
  snapshot_project_id: string
  snapshot_owner_user_id: string | null
  snapshot_owner_team_id: string | null
  snapshot_project_slug: string
  snapshot_project_name: string
  snapshot_project_description: string | null
  snapshot_project_github_url: string | null
  snapshot_project_created_by_user_id: string
  snapshot_project_created_at: number
  snapshot_project_updated_at: number
  snapshot_project_archived_at: number | null
  snapshot_owner_handle: string
  snapshot_owner_email: string | null
  snapshot_owner_name: string | null
  snapshot_owner_display_name: string | null
  snapshot_owner_avatar_url: string | null
  snapshot_owner_custom_avatar_id: string | null
  snapshot_owner_avatar_visible: number | null
  snapshot_team_name: string | null
  public_session_count: number
  snapshot_star_count: number
}

type PublicProjectSessionSnapshotRow = PublicProjectSnapshotColumns & {
  [Key in keyof PublicProjectSessionRow]: PublicProjectSessionRow[Key] | null
}

export async function listPublicProjectSessions(
  db: D1Database,
  handle: string,
  slug: string,
  options: ProjectSessionPageOptions,
): Promise<PublicProjectSessionSnapshot<PublicProjectSessionRow>> {
  const rows = await db
    .prepare(
      `/* projects:list-public-sessions */
       WITH project_snapshot AS (
         SELECT p.*,route_handle.handle AS snapshot_owner_handle,
           owner_user.email AS snapshot_owner_email,
           owner_user.name AS snapshot_owner_name,
           owner_user.display_name AS snapshot_owner_display_name,
           owner_user.avatar_url AS snapshot_owner_avatar_url,
           owner_user.custom_avatar_id AS snapshot_owner_custom_avatar_id,
           owner_user.avatar_visible AS snapshot_owner_avatar_visible,
           owner_team.name AS snapshot_team_name,
           (
             SELECT COUNT(*)
             FROM hub_sessions counted_session
             JOIN hub_session_discovery counted_projection
               ON counted_projection.sid=counted_session.sid
             WHERE counted_session.project_id=p.id
               AND counted_session.visibility='unlisted'
               AND counted_session.withdrawn_at IS NULL
               AND (
                 (p.owner_user_id IS NOT NULL
                   AND counted_session.team_id IS NULL
                   AND counted_session.owner_user_id=p.owner_user_id)
                 OR
                 (p.owner_team_id IS NOT NULL
                   AND counted_session.team_id=p.owner_team_id)
               )
           ) AS public_session_count,
           (
             SELECT COUNT(*)
             FROM project_stars relation
             JOIN users actor ON actor.id=relation.user_id
               AND actor.deleted_at IS NULL
               AND actor.deletion_pending_until IS NULL
             WHERE relation.project_id=p.id
           ) AS snapshot_star_count
         FROM handles route_handle
         JOIN projects p
           ON route_handle.user_id IS p.owner_user_id
           AND route_handle.team_id IS p.owner_team_id
         LEFT JOIN users owner_user ON owner_user.id=p.owner_user_id
           AND owner_user.deleted_at IS NULL
           AND owner_user.deletion_pending_until IS NULL
         LEFT JOIN teams owner_team ON owner_team.id=p.owner_team_id
           AND owner_team.archived_at IS NULL
           AND owner_team.deletion_pending_until IS NULL
         WHERE route_handle.handle=? AND route_handle.released_at IS NULL
           AND p.slug=? AND p.archived_at IS NULL
           AND (
             (p.owner_user_id IS NOT NULL AND owner_user.id IS NOT NULL)
             OR
             (p.owner_team_id IS NOT NULL AND owner_team.id IS NOT NULL)
           )
       ),
       authorized_project AS (
         SELECT *
         FROM project_snapshot
         WHERE owner_user_id IS NOT NULL OR public_session_count>0
       ),
       page AS (
         SELECT s.*,d.published_at AS project_sort_at,session_team.name AS team_name,
           (SELECT COUNT(*) FROM hub_session_stars star WHERE star.sid=s.sid) AS star_count,
           ${managedSessionProjection()}
         FROM authorized_project p
         JOIN hub_sessions s ON s.project_id=p.id
         ${managedSessionJoins('s')}
         JOIN hub_session_discovery d ON d.sid=s.sid
         LEFT JOIN teams session_team ON session_team.id=s.team_id
         WHERE (
             (p.owner_user_id IS NOT NULL
               AND s.team_id IS NULL
               AND s.owner_user_id=p.owner_user_id)
             OR
             (p.owner_team_id IS NOT NULL AND s.team_id=p.owner_team_id)
           )
           AND s.visibility='unlisted'
           AND s.withdrawn_at IS NULL
           AND (
             ?=0 OR d.published_at<? OR (d.published_at=? AND s.sid>?)
           )
         ORDER BY d.published_at DESC,s.sid ASC
         LIMIT ?
       )
       SELECT
         project.id AS snapshot_project_id,
         project.owner_user_id AS snapshot_owner_user_id,
         project.owner_team_id AS snapshot_owner_team_id,
         project.slug AS snapshot_project_slug,
         project.name AS snapshot_project_name,
         project.description AS snapshot_project_description,
         project.github_url AS snapshot_project_github_url,
         project.created_by_user_id AS snapshot_project_created_by_user_id,
         project.created_at AS snapshot_project_created_at,
         project.updated_at AS snapshot_project_updated_at,
         project.archived_at AS snapshot_project_archived_at,
         project.snapshot_owner_handle,
         project.snapshot_owner_email,
         project.snapshot_owner_name,
         project.snapshot_owner_display_name,
         project.snapshot_owner_avatar_url,
         project.snapshot_owner_custom_avatar_id,
         project.snapshot_owner_avatar_visible,
         project.snapshot_team_name,
         project.public_session_count,
         project.snapshot_star_count,
         page.*
       FROM authorized_project project
       LEFT JOIN page ON TRUE
       ORDER BY page.project_sort_at DESC,page.sid ASC`,
    )
    .bind(
      handle,
      slug,
      options.after === null ? 0 : 1,
      options.after?.sortAt ?? 0,
      options.after?.sortAt ?? 0,
      options.after?.sid ?? '',
      options.limit + 1,
    )
    .all<PublicProjectSessionSnapshotRow>()
  const snapshot = rows.results[0]
  if (!snapshot) throw new ApiError('NOT_FOUND')
  const page = finishProjectSessionPage(rows.results.filter(isPublicProjectSessionRow), options)
  return {
    ...page,
    owner: projectSnapshotOwner(snapshot),
    project: {
      id: snapshot.snapshot_project_id,
      owner_user_id: snapshot.snapshot_owner_user_id,
      owner_team_id: snapshot.snapshot_owner_team_id,
      slug: snapshot.snapshot_project_slug,
      name: snapshot.snapshot_project_name,
      description: snapshot.snapshot_project_description,
      github_url: snapshot.snapshot_project_github_url,
      created_by_user_id: snapshot.snapshot_project_created_by_user_id,
      created_at: snapshot.snapshot_project_created_at,
      updated_at: snapshot.snapshot_project_updated_at,
      archived_at: snapshot.snapshot_project_archived_at,
      session_count: Math.max(0, Number(snapshot.public_session_count)),
      star_count: Math.max(0, Number(snapshot.snapshot_star_count)),
    },
  }
}

function isPublicProjectSessionRow(
  row: PublicProjectSessionSnapshotRow,
): row is PublicProjectSessionSnapshotRow & PublicProjectSessionRow {
  return typeof row.sid === 'string'
}

function projectSnapshotOwner(row: PublicProjectSessionSnapshotRow): ResolvedHandleOwner {
  if (row.snapshot_owner_team_id !== null) {
    return {
      kind: 'team',
      id: row.snapshot_owner_team_id,
      handle: row.snapshot_owner_handle,
      name: row.snapshot_team_name ?? row.snapshot_owner_handle,
      avatar_url: null,
    }
  }
  if (row.snapshot_owner_user_id === null || row.snapshot_owner_email === null) {
    throw new ApiError('INTERNAL', 'Public Project owner missing')
  }
  return {
    kind: 'user',
    id: row.snapshot_owner_user_id,
    handle: row.snapshot_owner_handle,
    name: resolveDisplayName({
      display_name: row.snapshot_owner_display_name,
      name: row.snapshot_owner_name,
      email: row.snapshot_owner_email,
    }),
    avatar_url: visibleUserAvatarUrl({
      userId: row.snapshot_owner_user_id,
      avatarUrl: row.snapshot_owner_avatar_url,
      customAvatarId: row.snapshot_owner_custom_avatar_id,
      avatarVisible: row.snapshot_owner_avatar_visible,
    }),
  }
}

export async function listPublicSessionsForOwner(
  db: D1Database,
  owner: ResolvedHandleOwner,
  options: ProjectSessionPageOptions,
): Promise<
  ProjectSessionPage<
    HydratedManagedSessionRow & {
      team_name: string | null
      star_count: number
      project_sort_at: number
    }
  >
> {
  const rows = await db
    .prepare(
      `/* projects:list-public-owner-sessions */
       SELECT s.*, d.published_at AS project_sort_at, session_team.name AS team_name,
         (SELECT COUNT(*) FROM hub_session_stars star WHERE star.sid=s.sid) AS star_count,
         ${managedSessionProjection()}
       FROM hub_sessions s
       ${managedSessionJoins('s')}
       JOIN projects p ON p.id=s.project_id
       JOIN hub_session_discovery d ON d.sid=s.sid
       LEFT JOIN teams session_team ON session_team.id=s.team_id
       WHERE p.owner_user_id IS ? AND p.owner_team_id IS ?
         AND (
           (?=1 AND s.team_id IS NULL AND s.owner_user_id=p.owner_user_id
             AND EXISTS (
               SELECT 1 FROM users project_user
               WHERE project_user.id=p.owner_user_id
                 AND project_user.deleted_at IS NULL
                 AND project_user.deletion_pending_until IS NULL
             ))
           OR
           (?=1 AND s.team_id=p.owner_team_id
             AND EXISTS (
               SELECT 1 FROM teams project_team
               WHERE project_team.id=p.owner_team_id
                 AND project_team.archived_at IS NULL
                 AND project_team.deletion_pending_until IS NULL
             ))
         )
         AND s.visibility='unlisted' AND s.withdrawn_at IS NULL
         AND p.archived_at IS NULL
         AND (
           ?=0 OR d.published_at<? OR (d.published_at=? AND s.sid>?)
         )
       ORDER BY d.published_at DESC, s.sid ASC
       LIMIT ?`,
    )
    .bind(
      owner.kind === 'user' ? owner.id : null,
      owner.kind === 'team' ? owner.id : null,
      owner.kind === 'user' ? 1 : 0,
      owner.kind === 'team' ? 1 : 0,
      options.after === null ? 0 : 1,
      options.after?.sortAt ?? 0,
      options.after?.sortAt ?? 0,
      options.after?.sid ?? '',
      options.limit + 1,
    )
    .all<
      HydratedManagedSessionRow & {
        team_name: string | null
        star_count: number
        project_sort_at: number
      }
    >()
  return finishProjectSessionPage(rows.results, options)
}

export async function listPublicProjects(
  db: D1Database,
  args: { after: PublicProjectCursor | null; limit: number },
): Promise<PublicProjectRow[]> {
  const rows = await db
    .prepare(
      `/* projects:list-public */
       WITH public_projects AS (
         SELECT p.*,
           COUNT(*) AS session_count,
           MAX(d.published_at) AS last_session_at,
           (SELECT COUNT(*) FROM project_stars relation
            JOIN users star_user ON star_user.id=relation.user_id
              AND star_user.deleted_at IS NULL
              AND star_user.deletion_pending_until IS NULL
            WHERE relation.project_id=p.id) AS star_count,
           h.handle AS owner_handle,
           u.email AS owner_email,
           CASE WHEN p.owner_team_id IS NULL THEN u.name ELSE t.name END AS owner_name,
           u.display_name AS owner_display_name,
           u.avatar_url AS owner_avatar_url,
           u.custom_avatar_id AS owner_custom_avatar_id,
           COALESCE(u.avatar_visible,1) AS owner_avatar_visible
         FROM projects p
         LEFT JOIN users u ON u.id=p.owner_user_id
           AND u.deleted_at IS NULL AND u.deletion_pending_until IS NULL
         LEFT JOIN teams t ON t.id=p.owner_team_id
           AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
         JOIN handles h ON h.released_at IS NULL
           AND h.user_id IS p.owner_user_id AND h.team_id IS p.owner_team_id
         JOIN hub_sessions s ON s.project_id=p.id
           AND (
             (p.owner_user_id IS NOT NULL
               AND s.owner_user_id=p.owner_user_id AND s.team_id IS NULL)
             OR
             (p.owner_team_id IS NOT NULL AND s.team_id=p.owner_team_id)
           )
           AND s.visibility='unlisted'
           AND s.withdrawn_at IS NULL
         JOIN hub_session_discovery d ON d.sid=s.sid
         WHERE p.archived_at IS NULL
           AND ((p.owner_user_id IS NOT NULL AND u.id IS NOT NULL)
             OR (p.owner_team_id IS NOT NULL AND t.id IS NOT NULL))
         GROUP BY p.id
       )
       SELECT * FROM public_projects
       WHERE (?=0 OR last_session_at<? OR (last_session_at=? AND id>?))
       ORDER BY last_session_at DESC, id ASC
       LIMIT ?`,
    )
    .bind(
      args.after === null ? 0 : 1,
      args.after?.lastSessionAt ?? 0,
      args.after?.lastSessionAt ?? 0,
      args.after?.id ?? '',
      args.limit + 1,
    )
    .all<PublicProjectRow>()
  return rows.results
}

export async function listPublicProjectsForOwner(
  db: D1Database,
  owner: ResolvedHandleOwner,
): Promise<ProjectWithCount[]> {
  const rows = await db
    .prepare(
      `SELECT p.*, COUNT(d.sid) AS session_count,
         (SELECT COUNT(*) FROM project_stars relation
          JOIN users star_user ON star_user.id=relation.user_id
            AND star_user.deleted_at IS NULL
            AND star_user.deletion_pending_until IS NULL
          WHERE relation.project_id=p.id) AS star_count
       FROM projects p
       JOIN hub_sessions s ON s.project_id=p.id
       JOIN hub_session_discovery d ON d.sid=s.sid
       WHERE p.owner_user_id IS ? AND p.owner_team_id IS ?
         AND p.archived_at IS NULL
         AND (
           (?=1 AND s.team_id IS NULL AND s.owner_user_id=p.owner_user_id)
           OR
           (?=1 AND s.team_id=p.owner_team_id)
         )
         AND s.visibility='unlisted'
         AND s.withdrawn_at IS NULL
       GROUP BY p.id
       ORDER BY MAX(d.published_at) DESC, p.id ASC
       LIMIT ?`,
    )
    .bind(
      owner.kind === 'user' ? owner.id : null,
      owner.kind === 'team' ? owner.id : null,
      owner.kind === 'user' ? 1 : 0,
      owner.kind === 'team' ? 1 : 0,
      MAX_ACTIVE_PROJECTS_PER_TENANT + 1,
    )
    .all<ProjectWithCount>()
  return rows.results
}

export function isProjectConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /(UNIQUE constraint failed: projects|project tenant mismatch|project must be active)/i.test(
      error.message,
    )
  )
}

function finishProjectListPage<Row extends { updated_at: number; id: string }>(
  rows: Row[],
  options: ProjectListPageOptions,
): ProjectListPage<Row> {
  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeProjectListCursor({ updatedAt: last.updated_at, id: last.id }, options.fingerprint)
        : null,
  }
}

function encodeProjectListCursor(
  key: { updatedAt: number; id: string },
  fingerprint: string,
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: PROJECT_LIST_CURSOR_VERSION,
      f: fingerprint,
      u: key.updatedAt,
      i: key.id,
    }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeProjectListCursor(
  value: string,
  fingerprint: string,
): { updatedAt: number; id: string } {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
    ) as Record<string, unknown>
    if (
      parsed['v'] !== PROJECT_LIST_CURSOR_VERSION ||
      parsed['f'] !== fingerprint ||
      typeof parsed['u'] !== 'number' ||
      !Number.isSafeInteger(parsed['u']) ||
      parsed['u'] < 0 ||
      typeof parsed['i'] !== 'string' ||
      parsed['i'].length < 1 ||
      parsed['i'].length > 192
    ) {
      throw new Error('invalid')
    }
    return { updatedAt: parsed['u'], id: parsed['i'] }
  } catch {
    throw new ApiError('BAD_REQUEST', 'malformed or mismatched cursor')
  }
}

function finishProjectSessionPage<Row extends { project_sort_at: number; sid: string }>(
  rows: Row[],
  options: ProjectSessionPageOptions,
): ProjectSessionPage<Row> {
  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeProjectSessionCursor(
            { sortAt: last.project_sort_at, sid: last.sid },
            options.fingerprint,
          )
        : null,
  }
}

function encodeProjectSessionCursor(
  key: { sortAt: number; sid: string },
  fingerprint: string,
): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: PROJECT_SESSION_CURSOR_VERSION,
      f: fingerprint,
      s: key.sortAt,
      i: key.sid,
    }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeProjectSessionCursor(
  value: string,
  fingerprint: string,
): { sortAt: number; sid: string } {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
    ) as Record<string, unknown>
    if (
      parsed['v'] !== PROJECT_SESSION_CURSOR_VERSION ||
      parsed['f'] !== fingerprint ||
      typeof parsed['s'] !== 'number' ||
      !Number.isSafeInteger(parsed['s']) ||
      parsed['s'] < 0 ||
      typeof parsed['i'] !== 'string' ||
      parsed['i'].length < 1 ||
      parsed['i'].length > 192
    ) {
      throw new Error('invalid')
    }
    return { sortAt: parsed['s'], sid: parsed['i'] }
  } catch {
    throw new ApiError('BAD_REQUEST', 'malformed or mismatched cursor')
  }
}

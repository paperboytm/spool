import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { resolveDisplayName } from '../profile/display-name'
import { finishSocialListPage, type SocialListOptions, type SocialListPage } from './limits'

const LIVE_PROJECT_SESSION = `EXISTS (
  SELECT 1
  FROM hub_sessions live_session
  JOIN hub_session_discovery live_projection
    ON live_projection.sid=live_session.sid
  JOIN users live_author ON live_author.id=live_session.owner_user_id
  LEFT JOIN teams live_team ON live_team.id=live_session.team_id
    AND live_team.archived_at IS NULL
    AND live_team.deletion_pending_until IS NULL
  WHERE live_session.project_id=p.id
    AND live_session.visibility='unlisted'
    AND live_session.withdrawn_at IS NULL
    AND (
      (live_session.team_id IS NULL AND live_author.deleted_at IS NULL)
      OR
      (live_session.team_id IS NOT NULL AND live_team.id IS NOT NULL)
    )
  LIMIT 1
)`

const ACTIVE_PROJECT_OWNER = `(
  (
    p.owner_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM users project_user
      WHERE project_user.id=p.owner_user_id
        AND project_user.deleted_at IS NULL
        AND project_user.deletion_pending_until IS NULL
    )
  )
  OR
  (
    p.owner_team_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM teams project_team
      WHERE project_team.id=p.owner_team_id
        AND project_team.archived_at IS NULL
        AND project_team.deletion_pending_until IS NULL
    )
  )
)`

export type ProjectSocialTarget = {
  projectId: string
  ownerUserId: string | null
  ownerTeamId: string | null
  ownerHandle: string
  slug: string
  /** Personal Project metadata stays public before its first Session, while
   * Project social actions require a live Public Session. */
  isPublic: boolean
  hasLivePublicSession: boolean
}

export type ProjectSocialState = {
  version: 1
  starCount: number
  watcherCount: number
  viewerStarred: boolean
  viewerWatching: boolean
  viewerAuthenticated: boolean
  starEligible: boolean
  canStar: boolean
  canWatch: boolean
}

export type SocialIdentity = {
  id: string
  handle: string
  name: string
  avatar_url: string | null
}

export type SocialProject = {
  id: string
  slug: string
  name: string
  description: string | null
  github_url: string | null
  owner: {
    kind: 'user' | 'team'
    id: string
    handle: string
    name: string
    avatar_url: string | null
  }
  session_count: number
  star_count: number
  updated_at: number
}

type SocialProjectCursorRow = SocialProject & {
  social_created_at: number
  social_id: string
}

export type SocialProjectListResponse = {
  projects: SocialProject[]
  next_cursor: string | null
}

type ProjectTargetRow = {
  id: string
  owner_user_id: string | null
  owner_team_id: string | null
  owner_handle: string
  slug: string
  public_target: number
  live_public: number
  viewer_member: number
}

type ProjectSocialRow = {
  star_count: number
  watcher_count: number
  viewer_starred: number
  viewer_watching: number
  can_star: number
  can_watch: number
}

type IdentityRow = {
  social_id: string
  social_created_at: number
  handle: string
  email: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
  custom_avatar_id: string | null
  avatar_visible: number
}

type SocialProjectRow = {
  social_id: string
  social_created_at: number
  id: string
  slug: string
  name: string
  description: string | null
  github_url: string | null
  owner_user_id: string | null
  owner_team_id: string | null
  owner_handle: string
  owner_email: string | null
  owner_name: string | null
  owner_display_name: string | null
  owner_avatar_url: string | null
  owner_custom_avatar_id: string | null
  owner_avatar_visible: number
  public_target: number
  public_session_count: number
  tenant_session_count: number
  star_count: number
  updated_at: number
}

/**
 * Resolves the canonical owner/slug while preserving the Team tenant boundary.
 * Personal Projects keep their existing public metadata contract. A Team
 * Project is public-social only while it owns at least one live Discovery
 * Session; otherwise only a current member may resolve it.
 */
export async function resolveProjectSocialTarget(
  db: D1Database,
  handle: string,
  slug: string,
  viewerUserId: string | null,
): Promise<ProjectSocialTarget | null> {
  const row = await db
    .prepare(
      `/* social:resolve-project */
       SELECT p.id,p.owner_user_id,p.owner_team_id,p.slug,h.handle AS owner_handle,
         CASE WHEN ${LIVE_PROJECT_SESSION} THEN 1 ELSE 0 END AS live_public,
         CASE WHEN p.owner_user_id IS NOT NULL OR ${LIVE_PROJECT_SESSION}
           THEN 1 ELSE 0 END AS public_target,
         CASE WHEN p.owner_team_id IS NOT NULL AND ? IS NOT NULL AND EXISTS (
           SELECT 1
           FROM team_memberships member
           JOIN users viewer ON viewer.id=member.user_id
           WHERE member.team_id=p.owner_team_id AND member.user_id=?
             AND viewer.deleted_at IS NULL
             AND viewer.deletion_pending_until IS NULL
         ) THEN 1 ELSE 0 END AS viewer_member
       FROM handles h
       JOIN projects p
         ON p.owner_user_id IS h.user_id AND p.owner_team_id IS h.team_id
       WHERE h.handle=? AND h.released_at IS NULL
         AND p.slug=? AND p.archived_at IS NULL
         AND ${ACTIVE_PROJECT_OWNER}
       LIMIT 1`,
    )
    .bind(viewerUserId, viewerUserId, handle, slug)
    .first<ProjectTargetRow>()
  if (!row) return null
  const isPublic = row.public_target === 1
  if (!isPublic && row.viewer_member !== 1) return null
  return {
    projectId: row.id,
    ownerUserId: row.owner_user_id,
    ownerTeamId: row.owner_team_id,
    ownerHandle: row.owner_handle,
    slug: row.slug,
    isPublic,
    hasLivePublicSession: row.live_public === 1,
  }
}

export async function getProjectSocialState(
  db: D1Database,
  target: ProjectSocialTarget,
  viewerUserId: string | null,
): Promise<ProjectSocialState> {
  const row = await db
    .prepare(
      `/* social:project-state */
       SELECT
         CASE WHEN ?=1 THEN (
           SELECT COUNT(*)
           FROM project_stars relation
           JOIN users actor ON actor.id=relation.user_id
             AND actor.deleted_at IS NULL
             AND actor.deletion_pending_until IS NULL
           WHERE relation.project_id=p.id
         ) ELSE 0 END AS star_count,
         CASE
           WHEN ?=1 THEN (
             SELECT COUNT(*)
             FROM project_watches relation
             JOIN users actor ON actor.id=relation.user_id
               AND actor.deleted_at IS NULL
               AND actor.deletion_pending_until IS NULL
             WHERE relation.project_id=p.id
           )
           WHEN p.owner_team_id IS NOT NULL THEN (
             SELECT COUNT(*)
             FROM project_watches relation
             JOIN users actor ON actor.id=relation.user_id
               AND actor.deleted_at IS NULL
               AND actor.deletion_pending_until IS NULL
             JOIN team_memberships member
               ON member.team_id=p.owner_team_id AND member.user_id=relation.user_id
             WHERE relation.project_id=p.id
           )
           ELSE 0
         END AS watcher_count,
         CASE WHEN ?=1 AND ? IS NOT NULL THEN EXISTS (
           SELECT 1 FROM project_stars viewer_star
           WHERE viewer_star.project_id=p.id AND viewer_star.user_id=?
         ) ELSE 0 END AS viewer_starred,
         CASE
           WHEN ? IS NULL THEN 0
           WHEN ?=1 OR (
             p.owner_team_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM team_memberships member
               WHERE member.team_id=p.owner_team_id AND member.user_id=?
             )
           ) THEN EXISTS (
             SELECT 1 FROM project_watches viewer_watch
             WHERE viewer_watch.project_id=p.id AND viewer_watch.user_id=?
           )
           ELSE 0
         END AS viewer_watching,
         CASE WHEN ? IS NOT NULL AND ?=1 THEN 1 ELSE 0 END AS can_star,
         CASE
           WHEN ? IS NULL THEN 0
           WHEN ?=1 THEN 1
           WHEN p.owner_team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM team_memberships member
             WHERE member.team_id=p.owner_team_id AND member.user_id=?
           ) THEN 1
           ELSE 0
         END AS can_watch
       FROM projects p
       WHERE p.id=? AND p.archived_at IS NULL AND ${ACTIVE_PROJECT_OWNER}`,
    )
    .bind(
      target.hasLivePublicSession ? 1 : 0,
      target.hasLivePublicSession ? 1 : 0,
      target.hasLivePublicSession ? 1 : 0,
      viewerUserId,
      viewerUserId,
      viewerUserId,
      target.hasLivePublicSession ? 1 : 0,
      viewerUserId,
      viewerUserId,
      viewerUserId,
      target.hasLivePublicSession ? 1 : 0,
      viewerUserId,
      target.hasLivePublicSession ? 1 : 0,
      viewerUserId,
      target.projectId,
    )
    .first<ProjectSocialRow>()
  if (!row || (!target.isPublic && row.can_watch !== 1)) throw new ApiError('NOT_FOUND')
  return {
    version: 1,
    starCount: Math.max(0, Number(row.star_count)),
    watcherCount: Math.max(0, Number(row.watcher_count)),
    viewerStarred: row.viewer_starred === 1,
    viewerWatching: row.viewer_watching === 1,
    viewerAuthenticated: viewerUserId !== null,
    starEligible: target.hasLivePublicSession,
    canStar: row.can_star === 1,
    canWatch: row.can_watch === 1,
  }
}

export function starProject(
  db: D1Database,
  target: ProjectSocialTarget,
  actorUserId: string,
  now = Date.now(),
): Promise<void> {
  return addProjectRelation(db, 'project_stars', target.projectId, actorUserId, now)
}

export function unstarProject(
  db: D1Database,
  target: ProjectSocialTarget,
  actorUserId: string,
): Promise<void> {
  return removeProjectRelation(db, 'project_stars', target.projectId, actorUserId)
}

export function watchProject(
  db: D1Database,
  target: ProjectSocialTarget,
  actorUserId: string,
  now = Date.now(),
): Promise<void> {
  return addProjectRelation(db, 'project_watches', target.projectId, actorUserId, now)
}

export function unwatchProject(
  db: D1Database,
  target: ProjectSocialTarget,
  actorUserId: string,
): Promise<void> {
  return removeProjectRelation(db, 'project_watches', target.projectId, actorUserId)
}

export async function listProjectStargazers(
  db: D1Database,
  target: ProjectSocialTarget,
  options: SocialListOptions,
): Promise<SocialListPage<SocialIdentity>> {
  if (!target.hasLivePublicSession) throw new ApiError('NOT_FOUND')
  const rows = await db
    .prepare(
      `/* social:list-project-stargazers */
       SELECT actor.id AS social_id,relation.created_at AS social_created_at,
         handle.handle,actor.email,actor.name,actor.display_name,actor.avatar_url,
         actor.custom_avatar_id,COALESCE(actor.avatar_visible,1) AS avatar_visible
       FROM project_stars relation
       JOIN users actor ON actor.id=relation.user_id
       JOIN handles handle ON handle.user_id=actor.id
         AND handle.team_id IS NULL AND handle.released_at IS NULL
       WHERE relation.project_id=?
         AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL
         AND (
           ?=1 OR EXISTS (
             SELECT 1 FROM team_memberships member
             WHERE member.team_id=? AND member.user_id=actor.id
           )
         )
         AND (
           ?=0 OR relation.created_at<? OR
           (relation.created_at=? AND actor.id>?)
         )
       ORDER BY relation.created_at DESC,actor.id ASC
       LIMIT ?`,
    )
    .bind(
      target.projectId,
      target.isPublic ? 1 : 0,
      target.ownerTeamId,
      options.after === null ? 0 : 1,
      options.after?.createdAt ?? 0,
      options.after?.createdAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<IdentityRow>()
  const page = finishSocialListPage(
    rows.results.map((row) => ({
      social_id: row.social_id,
      social_created_at: row.social_created_at,
      id: row.social_id,
      handle: row.handle,
      name: resolveDisplayName(row),
      avatar_url: visibleAvatarUrl(row.social_id, row),
    })),
    options,
  )
  return {
    rows: page.rows.map(({ social_created_at: _, social_id: __, ...identity }) => identity),
    nextCursor: page.nextCursor,
  }
}

export async function listStarredProjectsForOwner(
  db: D1Database,
  ownerHandle: string,
  options: SocialListOptions,
): Promise<SocialListPage<SocialProject>> {
  const owner = await db
    .prepare(
      `SELECT user.id
       FROM handles handle
       JOIN users user ON user.id=handle.user_id
       WHERE handle.handle=? AND handle.team_id IS NULL
         AND handle.released_at IS NULL
         AND user.deleted_at IS NULL
         AND user.deletion_pending_until IS NULL`,
    )
    .bind(ownerHandle)
    .first<{ id: string }>()
  if (!owner) throw new ApiError('NOT_FOUND')

  const rows = await db
    .prepare(socialProjectListSql('project_stars', false))
    .bind(
      owner.id,
      options.after === null ? 0 : 1,
      options.after?.createdAt ?? 0,
      options.after?.createdAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<SocialProjectRow>()
  return finishSocialProjectPage(rows.results, options)
}

export async function listStarredProjectsForUser(
  db: D1Database,
  viewerUserId: string,
  options: SocialListOptions,
): Promise<SocialListPage<SocialProject>> {
  const rows = await db
    .prepare(socialProjectListSql('project_stars', false))
    .bind(
      viewerUserId,
      options.after === null ? 0 : 1,
      options.after?.createdAt ?? 0,
      options.after?.createdAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<SocialProjectRow>()
  return finishSocialProjectPage(rows.results, options)
}

export async function listWatchingProjectsForUser(
  db: D1Database,
  viewerUserId: string,
  options: SocialListOptions,
): Promise<SocialListPage<SocialProject>> {
  const rows = await db
    .prepare(socialProjectListSql('project_watches', true))
    .bind(
      viewerUserId,
      viewerUserId,
      options.after === null ? 0 : 1,
      options.after?.createdAt ?? 0,
      options.after?.createdAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<SocialProjectRow>()
  return finishSocialProjectPage(rows.results, options)
}

async function addProjectRelation(
  db: D1Database,
  table: 'project_stars' | 'project_watches',
  projectId: string,
  actorUserId: string,
  now: number,
): Promise<void> {
  const eligibility =
    table === 'project_stars'
      ? LIVE_PROJECT_SESSION
      : `(${LIVE_PROJECT_SESSION} OR (
           p.owner_team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM team_memberships member
             WHERE member.team_id=p.owner_team_id AND member.user_id=actor.id
           )
         ))`
  const result = await db
    .prepare(
      `/* social:add-project-relation */
       INSERT INTO ${table} (project_id,user_id,created_at)
       SELECT p.id,actor.id,?
       FROM projects p
       JOIN users actor ON actor.id=?
         AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL
       WHERE p.id=? AND p.archived_at IS NULL
         AND ${ACTIVE_PROJECT_OWNER}
         AND ${eligibility}
       ON CONFLICT(project_id,user_id) DO NOTHING`,
    )
    .bind(now, actorUserId, projectId)
    .run()
  if ((result.meta.changes ?? 0) > 0) return

  const allowed = await projectRelationAllowed(db, table, projectId, actorUserId)
  if (!allowed) throw new ApiError('NOT_FOUND')
}

async function removeProjectRelation(
  db: D1Database,
  table: 'project_stars' | 'project_watches',
  projectId: string,
  actorUserId: string,
): Promise<void> {
  const accessible = await projectAccessibleToActor(db, projectId, actorUserId)
  if (!accessible) throw new ApiError('NOT_FOUND')
  await db
    .prepare(`DELETE FROM ${table} WHERE project_id=? AND user_id=?`)
    .bind(projectId, actorUserId)
    .run()
}

async function projectAccessibleToActor(
  db: D1Database,
  projectId: string,
  actorUserId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `/* social:project-accessible */
       SELECT 1
       FROM projects p
       JOIN users actor ON actor.id=?
         AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL
       WHERE p.id=? AND p.archived_at IS NULL
         AND ${ACTIVE_PROJECT_OWNER}
         AND (
           p.owner_user_id IS NOT NULL
           OR ${LIVE_PROJECT_SESSION}
           OR EXISTS (
             SELECT 1 FROM team_memberships member
             WHERE member.team_id=p.owner_team_id AND member.user_id=actor.id
           )
         )`,
    )
    .bind(actorUserId, projectId)
    .first()
  return row !== null
}

async function projectRelationAllowed(
  db: D1Database,
  table: 'project_stars' | 'project_watches',
  projectId: string,
  actorUserId: string,
): Promise<boolean> {
  const eligibility =
    table === 'project_stars'
      ? LIVE_PROJECT_SESSION
      : `(${LIVE_PROJECT_SESSION} OR (
           p.owner_team_id IS NOT NULL AND EXISTS (
             SELECT 1 FROM team_memberships member
             WHERE member.team_id=p.owner_team_id AND member.user_id=actor.id
           )
         ))`
  const row = await db
    .prepare(
      `/* social:project-relation-allowed */
       SELECT 1
       FROM projects p
       JOIN users actor ON actor.id=?
         AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL
       WHERE p.id=? AND p.archived_at IS NULL
         AND ${ACTIVE_PROJECT_OWNER}
         AND ${eligibility}`,
    )
    .bind(actorUserId, projectId)
    .first()
  return row !== null
}

function socialProjectListSql(
  relationTable: 'project_stars' | 'project_watches',
  includePrivateMemberships: boolean,
): string {
  const visibility = includePrivateMemberships
    ? `(${LIVE_PROJECT_SESSION} OR EXISTS (
         SELECT 1 FROM team_memberships viewer_member
         WHERE viewer_member.team_id=p.owner_team_id AND viewer_member.user_id=?
       ))`
    : LIVE_PROJECT_SESSION
  return `/* social:list-project-relations */
    SELECT p.id AS social_id,relation.created_at AS social_created_at,
      p.id,p.slug,p.name,p.description,p.github_url,p.owner_user_id,p.owner_team_id,
      owner_handle.handle AS owner_handle,
      owner_user.email AS owner_email,
      CASE WHEN p.owner_team_id IS NOT NULL THEN owner_team.name ELSE owner_user.name END
        AS owner_name,
      owner_user.display_name AS owner_display_name,
      owner_user.avatar_url AS owner_avatar_url,
      owner_user.custom_avatar_id AS owner_custom_avatar_id,
      COALESCE(owner_user.avatar_visible,1) AS owner_avatar_visible,
      CASE WHEN ${LIVE_PROJECT_SESSION} THEN 1 ELSE 0 END AS public_target,
      (
        SELECT COUNT(*)
        FROM hub_sessions session
        JOIN hub_session_discovery projection ON projection.sid=session.sid
        JOIN users author ON author.id=session.owner_user_id
        LEFT JOIN teams session_team ON session_team.id=session.team_id
          AND session_team.archived_at IS NULL
          AND session_team.deletion_pending_until IS NULL
        WHERE session.project_id=p.id
          AND session.visibility='unlisted' AND session.withdrawn_at IS NULL
          AND (
            (session.team_id IS NULL AND author.deleted_at IS NULL)
            OR (session.team_id IS NOT NULL AND session_team.id IS NOT NULL)
          )
      ) AS public_session_count,
      (
        SELECT COUNT(*) FROM hub_sessions session
        WHERE session.project_id=p.id AND session.withdrawn_at IS NULL
      ) AS tenant_session_count,
      (
        SELECT COUNT(*)
        FROM project_stars project_star
        JOIN users starrer ON starrer.id=project_star.user_id
          AND starrer.deleted_at IS NULL
          AND starrer.deletion_pending_until IS NULL
        WHERE project_star.project_id=p.id
          AND ${LIVE_PROJECT_SESSION}
      ) AS star_count,
      p.updated_at
    FROM ${relationTable} relation
    JOIN projects p ON p.id=relation.project_id
    LEFT JOIN users owner_user ON owner_user.id=p.owner_user_id
    LEFT JOIN teams owner_team ON owner_team.id=p.owner_team_id
    JOIN handles owner_handle
      ON owner_handle.user_id IS p.owner_user_id
      AND owner_handle.team_id IS p.owner_team_id
      AND owner_handle.released_at IS NULL
    WHERE relation.user_id=? AND p.archived_at IS NULL
      AND ${ACTIVE_PROJECT_OWNER}
      AND ${visibility}
      AND (
        ?=0 OR relation.created_at<? OR
        (relation.created_at=? AND p.id>?)
      )
    ORDER BY relation.created_at DESC,p.id ASC
    LIMIT ?`
}

function serializeSocialProject(row: SocialProjectRow): SocialProjectCursorRow {
  const teamOwned = row.owner_team_id !== null
  const ownerId = row.owner_team_id ?? row.owner_user_id
  if (ownerId === null) throw new ApiError('INTERNAL', 'Project owner missing')
  const ownerName = teamOwned
    ? (row.owner_name ?? row.owner_handle)
    : resolveDisplayName({
        email: row.owner_email ?? row.owner_handle,
        name: row.owner_name,
        display_name: row.owner_display_name,
      })
  return {
    social_id: row.social_id,
    social_created_at: row.social_created_at,
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    github_url: row.github_url,
    owner: {
      kind: teamOwned ? 'team' : 'user',
      id: ownerId,
      handle: row.owner_handle,
      name: ownerName,
      avatar_url: teamOwned
        ? null
        : visibleAvatarUrl(row.owner_user_id!, {
            avatar_url: row.owner_avatar_url,
            custom_avatar_id: row.owner_custom_avatar_id,
            avatar_visible: row.owner_avatar_visible,
          }),
    },
    session_count:
      row.public_target === 1
        ? Math.max(0, Number(row.public_session_count))
        : Math.max(0, Number(row.tenant_session_count)),
    star_count: Math.max(0, Number(row.star_count)),
    updated_at: row.updated_at,
  }
}

function finishSocialProjectPage(
  rows: SocialProjectRow[],
  options: SocialListOptions,
): SocialListPage<SocialProject> {
  const page = finishSocialListPage(rows.map(serializeSocialProject), options)
  return {
    rows: page.rows.map(({ social_created_at: _, social_id: __, ...project }) => project),
    nextCursor: page.nextCursor,
  }
}

function visibleAvatarUrl(
  userId: string,
  row: {
    avatar_url: string | null
    custom_avatar_id: string | null
    avatar_visible: number
  },
): string | null {
  if (row.avatar_visible !== 1) return null
  return row.custom_avatar_id
    ? `/api/avatars/${encodeURIComponent(userId)}?v=${encodeURIComponent(row.custom_avatar_id)}`
    : row.avatar_url
}

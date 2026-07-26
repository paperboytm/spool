import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { resolveDisplayName } from '../profile/display-name'
import {
  MAX_ACTIVE_TEAMS_CREATED_PER_USER,
  MAX_PENDING_INVITATIONS_PER_TEAM,
  MAX_TEAM_INVITATION_LIST_RESULTS,
  MAX_TEAM_LIST_RESULTS,
  MAX_TEAM_MEMBER_LIST_RESULTS,
  MAX_TEAM_MEMBERS_AND_PENDING,
} from './limits'
import {
  permissionsForRole,
  type TeamInvitationResponse,
  type TeamInvitationRow,
  type TeamMemberResponse,
  type TeamMemberPermission,
  type TeamMembershipRow,
  type TeamResponse,
  type TeamRole,
  type TeamRow,
} from './types'
import type { WorkosInvitation, WorkosMembership } from './workos-client'

export function newTeamId(): string {
  return `team_${crypto.randomUUID().replace(/-/g, '')}`
}

export function newTeamInvitationId(): string {
  return `tinv_${crypto.randomUUID().replace(/-/g, '')}`
}

export type TeamInvitationCreationRequestRow = {
  team_id: string
  invited_by_user_id: string
  idempotency_key: string
  invitation_id: string
  normalized_email: string
  desired_role: 'admin' | 'member'
  status: 'pending' | 'completed' | 'failed'
  workos_invitation_id: string | null
  created_at: number
  updated_at: number
}

export async function getTeamInvitationCreationRequest(
  db: D1Database,
  teamId: string,
  invitedByUserId: string,
  idempotencyKey: string,
): Promise<TeamInvitationCreationRequestRow | null> {
  return db
    .prepare(
      `/* teams:get-invitation-creation-request */
       SELECT * FROM team_invitation_requests
       WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?`,
    )
    .bind(teamId, invitedByUserId, idempotencyKey)
    .first<TeamInvitationCreationRequestRow>()
}

export async function beginTeamInvitationCreationRequest(
  db: D1Database,
  args: {
    teamId: string
    invitedByUserId: string
    idempotencyKey: string
    invitationId: string
    email: string
    desiredRole: 'admin' | 'member'
    now: number
  },
): Promise<{ created: boolean; request: TeamInvitationCreationRequestRow }> {
  const result = await db
    .prepare(
      `/* teams:begin-invitation-creation-request */
       INSERT OR IGNORE INTO team_invitation_requests
         (team_id, invited_by_user_id, idempotency_key, invitation_id,
          normalized_email, desired_role, status, workos_invitation_id,
          created_at, updated_at)
       SELECT ?,?,?,?,?,?,'pending',NULL,?,?
       WHERE EXISTS (
         SELECT 1 FROM team_memberships actor JOIN users actor_user ON actor_user.id=actor.user_id
         WHERE actor.team_id=? AND actor.user_id=?
           AND actor.role IN ('owner','admin')
           AND actor_user.deleted_at IS NULL
           AND actor_user.deletion_pending_until IS NULL
       )`,
    )
    .bind(
      args.teamId,
      args.invitedByUserId,
      args.idempotencyKey,
      args.invitationId,
      args.email,
      args.desiredRole,
      args.now,
      args.now,
      args.teamId,
      args.invitedByUserId,
    )
    .run()
  const request = await getTeamInvitationCreationRequest(
    db,
    args.teamId,
    args.invitedByUserId,
    args.idempotencyKey,
  )
  if (!request) throw new ApiError('FORBIDDEN')
  return { created: result.meta.changes > 0, request }
}

export async function recordTeamInvitationCreationWorkosId(
  db: D1Database,
  args: {
    teamId: string
    invitedByUserId: string
    idempotencyKey: string
    workosInvitationId: string
    now: number
  },
): Promise<void> {
  await db
    .prepare(
      `/* teams:record-invitation-creation-workos-id */
       UPDATE team_invitation_requests
       SET workos_invitation_id=?, updated_at=?
       WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?
         AND status='pending'
         AND (workos_invitation_id IS NULL OR workos_invitation_id=?)`,
    )
    .bind(
      args.workosInvitationId,
      args.now,
      args.teamId,
      args.invitedByUserId,
      args.idempotencyKey,
      args.workosInvitationId,
    )
    .run()
}

export async function completeTeamInvitationCreationRequest(
  db: D1Database,
  args: {
    teamId: string
    invitedByUserId: string
    idempotencyKey: string
    invitationId: string
    workosInvitationId: string
    now: number
  },
): Promise<void> {
  await db
    .prepare(
      `/* teams:complete-invitation-creation-request-recovery */
       UPDATE team_invitation_requests SET status='completed', updated_at=?
       WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?
         AND invitation_id=? AND status='pending'
         AND EXISTS (
           SELECT 1 FROM team_invitations invitation
           WHERE invitation.id=team_invitation_requests.invitation_id
             AND invitation.team_id=team_invitation_requests.team_id
             AND invitation.workos_invitation_id=?
         )`,
    )
    .bind(
      args.now,
      args.teamId,
      args.invitedByUserId,
      args.idempotencyKey,
      args.invitationId,
      args.workosInvitationId,
    )
    .run()
}

export async function failTeamInvitationCreationRequest(
  db: D1Database,
  args: {
    teamId: string
    invitedByUserId: string
    idempotencyKey: string
    now: number
  },
): Promise<boolean> {
  const cleanupId = newWorkosCleanupId()
  const results = await db.batch([
    db
      .prepare(
        `/* teams:fail-invitation-enqueue-cleanup */
         INSERT INTO workos_cleanup_outbox
           (id, operation, resource_id, team_id, user_id, attempts,
            next_attempt_at, last_error, created_at, updated_at)
         SELECT ?, 'invitation.revoke', request.workos_invitation_id,
                request.team_id, request.invited_by_user_id, 0, ?, NULL, ?, ?
         FROM team_invitation_requests request
         WHERE request.team_id=? AND request.invited_by_user_id=?
           AND request.idempotency_key=? AND request.status='pending'
           AND request.workos_invitation_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM team_invitations invitation
             WHERE invitation.id=request.invitation_id
               AND invitation.team_id=request.team_id
           )
         ON CONFLICT(operation,resource_id) DO UPDATE SET
           next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
           updated_at=excluded.updated_at`,
      )
      .bind(
        cleanupId,
        args.now,
        args.now,
        args.now,
        args.teamId,
        args.invitedByUserId,
        args.idempotencyKey,
      ),
    db
      .prepare(
        `/* teams:fail-invitation-creation-request */
         UPDATE team_invitation_requests SET status='failed', updated_at=?
         WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?
           AND status='pending' AND workos_invitation_id IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM workos_cleanup_outbox cleanup
             WHERE cleanup.operation='invitation.revoke'
               AND cleanup.resource_id=team_invitation_requests.workos_invitation_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM team_invitations invitation
             WHERE invitation.id=team_invitation_requests.invitation_id
               AND invitation.team_id=team_invitation_requests.team_id
           )`,
      )
      .bind(args.now, args.teamId, args.invitedByUserId, args.idempotencyKey),
  ])
  return (results[1]?.meta.changes ?? 0) > 0
}

export type TeamCreationRequestRow = {
  user_id: string
  idempotency_key: string
  team_id: string
  normalized_name: string
  requested_handle: string | null
  status: 'pending' | 'completed' | 'failed'
  workos_organization_id: string | null
  created_at: number
  updated_at: number
}

export async function getTeamCreationRequest(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<TeamCreationRequestRow | null> {
  return db
    .prepare(
      '/* teams:get-creation-request */ SELECT * FROM team_creation_requests WHERE user_id=? AND idempotency_key=?',
    )
    .bind(userId, idempotencyKey)
    .first<TeamCreationRequestRow>()
}

export async function beginTeamCreationRequest(
  db: D1Database,
  args: {
    userId: string
    idempotencyKey: string
    teamId: string
    name: string
    requestedHandle: string
    now: number
  },
): Promise<{ created: boolean; request: TeamCreationRequestRow }> {
  const result = await db
    .prepare(
      `/* teams:begin-creation-request */
       INSERT OR IGNORE INTO team_creation_requests
         (user_id, idempotency_key, team_id, normalized_name, requested_handle, status,
          workos_organization_id, created_at, updated_at)
       VALUES (?,?,?,?,?,'pending',NULL,?,?)`,
    )
    .bind(
      args.userId,
      args.idempotencyKey,
      args.teamId,
      args.name,
      args.requestedHandle,
      args.now,
      args.now,
    )
    .run()
  const request = await getTeamCreationRequest(db, args.userId, args.idempotencyKey)
  if (!request) throw new ApiError('INTERNAL', 'team creation request could not be loaded')
  return { created: result.meta.changes > 0, request }
}

/**
 * Older pending/completed receipts predate handle intent. A retry may adopt
 * one handle exactly once; after that the migration trigger and this predicate
 * make the intent immutable.
 */
export async function adoptTeamCreationHandle(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
  requestedHandle: string,
  now: number,
): Promise<TeamCreationRequestRow> {
  await db
    .prepare(
      `/* teams:adopt-creation-handle */
       UPDATE team_creation_requests
       SET requested_handle=?, updated_at=?
       WHERE user_id=? AND idempotency_key=? AND requested_handle IS NULL`,
    )
    .bind(requestedHandle, now, userId, idempotencyKey)
    .run()
  const request = await getTeamCreationRequest(db, userId, idempotencyKey)
  if (!request) throw new ApiError('INTERNAL', 'team creation request could not be loaded')
  return request
}

export async function recordTeamCreationOrganization(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
  organizationId: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `/* teams:record-creation-organization */
       UPDATE team_creation_requests
       SET workos_organization_id=?, updated_at=?
       WHERE user_id=? AND idempotency_key=? AND status='pending'
         AND (workos_organization_id IS NULL OR workos_organization_id=?)`,
    )
    .bind(organizationId, now, userId, idempotencyKey, organizationId)
    .run()
}

export async function failTeamCreationRequest(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
  now: number,
): Promise<boolean> {
  const cleanupId = newWorkosCleanupId()
  const results = await db.batch([
    db
      .prepare(
        `/* teams:fail-creation-enqueue-cleanup */
         INSERT INTO workos_cleanup_outbox
           (id, operation, resource_id, team_id, user_id, attempts,
            next_attempt_at, last_error, created_at, updated_at)
         SELECT ?, 'organization.delete', request.workos_organization_id,
                request.team_id, request.user_id, 0, ?, NULL, ?, ?
         FROM team_creation_requests request
         WHERE request.user_id=? AND request.idempotency_key=?
           AND request.status='pending' AND request.workos_organization_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id
             WHERE t.id=request.team_id AND m.user_id=request.user_id AND m.role='owner'
           )
         ON CONFLICT(operation,resource_id) DO UPDATE SET
           next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
           updated_at=excluded.updated_at`,
      )
      .bind(cleanupId, now, now, now, userId, idempotencyKey),
    db
      .prepare(
        `/* teams:fail-creation-request */
         UPDATE team_creation_requests SET status='failed', updated_at=?
         WHERE user_id=? AND idempotency_key=? AND status='pending'
           AND (
             workos_organization_id IS NULL OR
             EXISTS (
               SELECT 1 FROM workos_cleanup_outbox cleanup
               WHERE cleanup.operation='organization.delete'
                 AND cleanup.resource_id=team_creation_requests.workos_organization_id
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id
             WHERE t.id=team_creation_requests.team_id
               AND m.user_id=team_creation_requests.user_id AND m.role='owner'
           )`,
      )
      .bind(now, userId, idempotencyKey),
  ])
  return (results[1]?.meta.changes ?? 0) > 0
}

export async function completeTeamCreationRequest(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
  teamId: string,
  requestedHandle: string,
  now: number,
): Promise<void> {
  await db
    .prepare(
      `/* teams:complete-creation-request-recovery */
       UPDATE team_creation_requests SET status='completed', updated_at=?
       WHERE user_id=? AND idempotency_key=? AND team_id=? AND status='pending'
         AND requested_handle=?
         AND EXISTS (
           SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id
           WHERE t.id=? AND m.user_id=? AND m.role='owner'
             AND EXISTS (
               SELECT 1 FROM handles h
               WHERE h.team_id=t.id AND h.handle=? AND h.released_at IS NULL
             )
         )`,
    )
    .bind(now, userId, idempotencyKey, teamId, requestedHandle, teamId, userId, requestedHandle)
    .run()
}

function newWorkosCleanupId(): string {
  return `woc_${crypto.randomUUID().replace(/-/g, '')}`
}

export async function getWorkosUserId(db: D1Database, userId: string): Promise<string> {
  const row = await db
    .prepare(
      "/* teams:workos-user */ SELECT provider_sub FROM user_identities WHERE user_id=? AND provider='workos'",
    )
    .bind(userId)
    .first<{ provider_sub: string }>()
  if (!row) throw new ApiError('CONFLICT', 'WorkOS identity is not linked')
  return row.provider_sub
}

export async function createLocalTeam(
  db: D1Database,
  args: {
    id: string
    name: string
    workosOrganizationId: string
    workosMembershipId: string
    workosMembershipUpdatedAt?: number | null
    idempotencyKey: string
    ownerUserId: string
    requestedHandle: string
    now: number
  },
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `/* teams:create */
         INSERT INTO teams
           (id, workos_organization_id, name, created_by_user_id, created_at,
            updated_at, deletion_pending_until, archived_at)
         SELECT ?,?,?,?,?,?,NULL,NULL
         WHERE (SELECT COUNT(*) FROM teams WHERE created_by_user_id=? AND archived_at IS NULL) < ?
           AND EXISTS (
             SELECT 1 FROM team_creation_requests
             WHERE user_id=? AND idempotency_key=? AND team_id=? AND status='pending'
               AND requested_handle=? AND workos_organization_id=?
           )
           AND EXISTS (
             SELECT 1 FROM users owner
             WHERE owner.id=? AND owner.deleted_at IS NULL
               AND owner.deletion_pending_until IS NULL
           )`,
      )
      .bind(
        args.id,
        args.workosOrganizationId,
        args.name,
        args.ownerUserId,
        args.now,
        args.now,
        args.ownerUserId,
        MAX_ACTIVE_TEAMS_CREATED_PER_USER,
        args.ownerUserId,
        args.idempotencyKey,
        args.id,
        args.requestedHandle,
        args.workosOrganizationId,
        args.ownerUserId,
      ),
    db
      .prepare(
        "/* teams:create-owner */ INSERT INTO team_memberships (team_id, user_id, role, workos_membership_id, workos_updated_at, joined_at, updated_at) SELECT ?,?,'owner',?,?,?,? WHERE EXISTS (SELECT 1 FROM teams WHERE id=? AND workos_organization_id=?)",
      )
      .bind(
        args.id,
        args.ownerUserId,
        args.workosMembershipId,
        args.workosMembershipUpdatedAt ?? null,
        args.now,
        args.now,
        args.id,
        args.workosOrganizationId,
      ),
    db
      .prepare(
        `/* teams:create-handle */
         INSERT INTO handles (handle, user_id, team_id, claimed_at, released_at)
         SELECT ?,NULL,t.id,?,NULL
         FROM teams t
         JOIN team_memberships membership ON membership.team_id=t.id
         JOIN team_creation_requests request ON request.team_id=t.id
         WHERE t.id=? AND t.workos_organization_id=?
           AND membership.user_id=? AND membership.role='owner'
           AND request.user_id=? AND request.idempotency_key=?
           AND request.status='pending' AND request.requested_handle=?`,
      )
      .bind(
        args.requestedHandle,
        args.now,
        args.id,
        args.workosOrganizationId,
        args.ownerUserId,
        args.ownerUserId,
        args.idempotencyKey,
        args.requestedHandle,
      ),
    db
      .prepare(
        `/* teams:complete-creation-request */
         UPDATE team_creation_requests SET status='completed', updated_at=?
         WHERE user_id=? AND idempotency_key=? AND team_id=? AND status='pending'
           AND requested_handle=?
           AND EXISTS (
             SELECT 1 FROM teams t JOIN team_memberships m ON m.team_id=t.id
             WHERE t.id=? AND t.workos_organization_id=?
               AND m.user_id=? AND m.role='owner'
               AND EXISTS (
                 SELECT 1 FROM handles h
                 WHERE h.team_id=t.id AND h.handle=? AND h.released_at IS NULL
               )
           )`,
      )
      .bind(
        args.now,
        args.ownerUserId,
        args.idempotencyKey,
        args.id,
        args.requestedHandle,
        args.id,
        args.workosOrganizationId,
        args.ownerUserId,
        args.requestedHandle,
      ),
  ])
  return (
    (results[0]?.meta.changes ?? 0) > 0 &&
    (results[1]?.meta.changes ?? 0) > 0 &&
    (results[2]?.meta.changes ?? 0) > 0 &&
    (results[3]?.meta.changes ?? 0) > 0
  )
}

type TeamListRow = TeamRow & {
  role: TeamRole
  member_count: number
  owner_count: number
  handle: string | null
}

export async function listTeamsForUser(db: D1Database, userId: string): Promise<TeamResponse[]> {
  const result = await db
    .prepare(
      `/* teams:list */
       SELECT t.*, m.role,
         (SELECT handle FROM handles h
          WHERE h.team_id=t.id AND h.released_at IS NULL LIMIT 1) AS handle,
         (SELECT COUNT(*) FROM team_memberships members WHERE members.team_id=t.id) AS member_count,
         (SELECT COUNT(*) FROM team_memberships owners
          WHERE owners.team_id=t.id AND owners.role='owner') AS owner_count
       FROM team_memberships m
       JOIN teams t ON t.id=m.team_id
       WHERE m.user_id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
       ORDER BY t.updated_at DESC, t.id ASC
       LIMIT ?`,
    )
    .bind(userId, MAX_TEAM_LIST_RESULTS)
    .all<TeamListRow>()
  return result.results.map(teamResponse)
}

export async function countActiveTeamsCreatedByUser(
  db: D1Database,
  userId: string,
): Promise<number> {
  const row = await db
    .prepare(
      '/* teams:count-active-created */ SELECT COUNT(*) AS count FROM teams WHERE created_by_user_id=? AND archived_at IS NULL',
    )
    .bind(userId)
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function getTeamById(db: D1Database, teamId: string): Promise<TeamRow | null> {
  return db
    .prepare('/* teams:get */ SELECT * FROM teams WHERE id=? AND archived_at IS NULL')
    .bind(teamId)
    .first<TeamRow>()
}

export async function getTeamByWorkosOrganizationId(
  db: D1Database,
  organizationId: string,
): Promise<TeamRow | null> {
  return db
    .prepare(
      '/* teams:get-by-workos-org */ SELECT * FROM teams WHERE workos_organization_id=? AND archived_at IS NULL',
    )
    .bind(organizationId)
    .first<TeamRow>()
}

export async function getTeamMembership(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamMembershipRow | null> {
  return db
    .prepare(
      '/* teams:get-membership */ SELECT * FROM team_memberships WHERE team_id=? AND user_id=?',
    )
    .bind(teamId, userId)
    .first<TeamMembershipRow>()
}

export async function getTeamForMember(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamResponse | null> {
  const row = await db
    .prepare(
      `/* teams:get-for-member */
       SELECT t.*, m.role,
         (SELECT handle FROM handles h
          WHERE h.team_id=t.id AND h.released_at IS NULL LIMIT 1) AS handle,
         (SELECT COUNT(*) FROM team_memberships members WHERE members.team_id=t.id) AS member_count,
         (SELECT COUNT(*) FROM team_memberships owners
          WHERE owners.team_id=t.id AND owners.role='owner') AS owner_count
       FROM teams t
       JOIN team_memberships m ON m.team_id=t.id
       WHERE t.id=? AND m.user_id=? AND t.archived_at IS NULL`,
    )
    .bind(teamId, userId)
    .first<TeamListRow>()
  return row ? teamResponse(row) : null
}

export async function updateLocalTeamName(
  db: D1Database,
  teamId: string,
  actorUserId: string,
  name: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `/* teams:update-name */
       UPDATE teams SET name=?, updated_at=?
       WHERE id=? AND archived_at IS NULL
         AND EXISTS (
           SELECT 1 FROM team_memberships actor
           WHERE actor.team_id=teams.id AND actor.user_id=?
             AND actor.role IN ('owner','admin')
         )`,
    )
    .bind(name, now, teamId, actorUserId)
    .run()
  return result.meta.changes > 0
}

export async function archiveLocalTeam(
  db: D1Database,
  teamId: string,
  actorUserId: string,
  now: number,
): Promise<boolean> {
  const cleanupId = newWorkosCleanupId()
  // Archiving a Team is also a disclosure change. The Team tombstone, every
  // Team-owned Session's private visibility, and removal from Explore must
  // commit as one D1 transaction so no formerly-public Team Session can stay
  // discoverable after the workspace is closed.
  const results = await db.batch([
    db
      .prepare(
        `/* teams:archive */
         UPDATE teams SET archived_at=?, deletion_pending_until=NULL, updated_at=?
         WHERE id=? AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM team_memberships actor
             WHERE actor.team_id=teams.id AND actor.user_id=? AND actor.role='owner'
           )`,
      )
      .bind(now, now, teamId, actorUserId),
    db
      .prepare(
        "/* teams:archive-sessions */ UPDATE hub_sessions SET visibility='private', updated_at=? WHERE team_id=? AND EXISTS (SELECT 1 FROM teams WHERE id=? AND archived_at=?)",
      )
      .bind(now, teamId, teamId, now),
    db
      .prepare(
        '/* teams:archive-discovery-engagement */ DELETE FROM hub_session_engagement_daily WHERE sid IN (SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND t.archived_at=?)',
      )
      .bind(teamId, now),
    db
      .prepare(
        '/* teams:archive-session-stars */ DELETE FROM hub_session_stars WHERE sid IN (SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND t.archived_at=?)',
      )
      .bind(teamId, now),
    db
      .prepare(
        '/* teams:archive-discovery */ DELETE FROM hub_session_discovery WHERE sid IN (SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id WHERE s.team_id=? AND t.archived_at=?)',
      )
      .bind(teamId, now),
    db
      .prepare(
        `/* teams:archive-workos-cleanup */
         INSERT INTO workos_cleanup_outbox
           (id, operation, resource_id, team_id, user_id, attempts,
            next_attempt_at, last_error, created_at, updated_at)
         SELECT ?, 'organization.delete', workos_organization_id, id, NULL,
                0, ?, NULL, ?, ?
         FROM teams WHERE id=? AND archived_at=?
         ON CONFLICT(operation,resource_id) DO UPDATE SET
           next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
           updated_at=excluded.updated_at`,
      )
      .bind(cleanupId, now, now, now, teamId, now),
  ])
  return (results[0]?.meta.changes ?? 0) > 0
}

type MemberListRow = TeamMembershipRow & {
  email: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
  custom_avatar_id: string | null
  avatar_visible: number | null
}

export async function listTeamMembers(
  db: D1Database,
  teamId: string,
  actor: TeamMembershipRow,
): Promise<TeamMemberResponse[]> {
  const [result, ownerCount] = await Promise.all([
    db
      .prepare(
        `/* teams:list-members */
         SELECT m.*, u.email, u.name, u.display_name, u.avatar_url, u.custom_avatar_id, u.avatar_visible
         FROM team_memberships m
         JOIN users u ON u.id=m.user_id
         WHERE m.team_id=? AND u.deleted_at IS NULL
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                  m.joined_at ASC, m.user_id ASC
         LIMIT ?`,
      )
      .bind(teamId, MAX_TEAM_MEMBER_LIST_RESULTS)
      .all<MemberListRow>(),
    countTeamOwners(db, teamId),
  ])
  return result.results.map((row) => {
    const visible = (row.avatar_visible ?? 1) !== 0
    const avatarUrl = !visible
      ? null
      : row.custom_avatar_id
        ? `/api/avatars/${encodeURIComponent(row.user_id)}?v=${encodeURIComponent(row.custom_avatar_id)}`
        : row.avatar_url
    return {
      user_id: row.user_id,
      email: row.email,
      display_name: resolveDisplayName(row),
      ...(avatarUrl === null ? {} : { avatar_url: avatarUrl }),
      role: row.role,
      permissions: memberPermissions(actor, row, ownerCount),
      joined_at: row.joined_at,
    }
  })
}

export async function countTeamOwners(db: D1Database, teamId: string): Promise<number> {
  const row = await db
    .prepare(
      "/* teams:count-owners */ SELECT COUNT(*) AS count FROM team_memberships WHERE team_id=? AND role='owner'",
    )
    .bind(teamId)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function updateMemberRole(
  db: D1Database,
  teamId: string,
  userId: string,
  actorUserId: string,
  role: TeamRole,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `/* teams:update-role */
       UPDATE team_memberships AS target SET role=?, updated_at=?
       WHERE target.team_id=? AND target.user_id=?
         AND EXISTS (
           SELECT 1 FROM team_memberships actor
           WHERE actor.team_id=target.team_id AND actor.user_id=?
             AND (
               actor.role='owner' OR
               (actor.role='admin' AND target.role='member' AND ?<>'owner')
             )
         )
         AND (
           target.role<>'owner' OR ?='owner' OR EXISTS (
             SELECT 1 FROM team_memberships other_owner
             WHERE other_owner.team_id=target.team_id AND other_owner.role='owner'
               AND other_owner.user_id<>target.user_id
           )
         )`,
    )
    .bind(role, now, teamId, userId, actorUserId, role, role)
    .run()
  return result.meta.changes > 0
}

export async function transferTeamOwnership(
  db: D1Database,
  teamId: string,
  ownerUserId: string,
  targetUserId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `/* teams:transfer-ownership */
       UPDATE team_memberships
       SET role=CASE WHEN user_id=? THEN 'owner' ELSE 'admin' END, updated_at=?
       WHERE team_id=? AND user_id IN (?,?) AND ?<>?
         AND EXISTS (
           SELECT 1 FROM team_memberships actor
           WHERE actor.team_id=? AND actor.user_id=? AND actor.role='owner'
         )
         AND EXISTS (
           SELECT 1 FROM team_memberships target
           WHERE target.team_id=? AND target.user_id=?
         )
         AND EXISTS (
           SELECT 1 FROM users target_user
           WHERE target_user.id=? AND target_user.deleted_at IS NULL
             AND target_user.deletion_pending_until IS NULL
         )`,
    )
    .bind(
      targetUserId,
      now,
      teamId,
      ownerUserId,
      targetUserId,
      ownerUserId,
      targetUserId,
      teamId,
      ownerUserId,
      teamId,
      targetUserId,
      targetUserId,
    )
    .run()
  return result.meta.changes === 2
}

export async function removeLocalMembership(
  db: D1Database,
  teamId: string,
  userId: string,
  blockedByUserId: string,
  expectedWorkosMembershipId: string | null,
  now: number,
): Promise<boolean> {
  const workosIdentity = await db
    .prepare(
      "/* teams:workos-user-for-block */ SELECT provider_sub FROM user_identities WHERE user_id=? AND provider='workos'",
    )
    .bind(userId)
    .first<{ provider_sub: string }>()
  const workosUserId = workosIdentity?.provider_sub ?? null
  const cleanupId = newWorkosCleanupId()
  const results = await db.batch([
    db
      .prepare(
        `/* teams:remove-membership */
         DELETE FROM team_memberships
         WHERE team_id=? AND user_id=?
           AND ((? IS NULL AND workos_membership_id IS NULL) OR workos_membership_id=?)
           AND (
             ?=user_id OR EXISTS (
               SELECT 1 FROM team_memberships actor
               WHERE actor.team_id=? AND actor.user_id=?
                 AND (
                   actor.role='owner' OR
                   (actor.role='admin' AND team_memberships.role='member')
                 )
             )
           )
           AND (
             role<>'owner' OR EXISTS (
               SELECT 1 FROM team_memberships other_owner
               WHERE other_owner.team_id=? AND other_owner.role='owner'
                 AND other_owner.user_id<>?
             )
           )`,
      )
      .bind(
        teamId,
        userId,
        expectedWorkosMembershipId,
        expectedWorkosMembershipId,
        blockedByUserId,
        teamId,
        blockedByUserId,
        teamId,
        userId,
      ),
    db
      .prepare(
        '/* teams:replace-workos-block */ DELETE FROM team_membership_blocks WHERE team_id=? AND workos_user_id=? AND user_id<>? AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id=? AND user_id=?)',
      )
      .bind(teamId, workosUserId, userId, teamId, userId),
    db
      .prepare(
        '/* teams:block-membership */ INSERT INTO team_membership_blocks (team_id, user_id, workos_user_id, blocked_at, blocked_by_user_id) SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id=? AND user_id=?) ON CONFLICT(team_id,user_id) DO UPDATE SET workos_user_id=excluded.workos_user_id, blocked_at=excluded.blocked_at, blocked_by_user_id=excluded.blocked_by_user_id',
      )
      .bind(teamId, userId, workosUserId, now, blockedByUserId, teamId, userId),
    db
      .prepare(
        `/* teams:remove-workos-cleanup */
         INSERT INTO workos_cleanup_outbox
           (id, operation, resource_id, team_id, user_id, attempts,
            next_attempt_at, last_error, created_at, updated_at)
         SELECT ?, 'membership.delete', ?, ?, ?, 0, ?, NULL, ?, ?
         WHERE ? IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM team_memberships WHERE team_id=? AND user_id=?
           )
         ON CONFLICT(operation,resource_id) DO UPDATE SET
           next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
           updated_at=excluded.updated_at`,
      )
      .bind(
        cleanupId,
        expectedWorkosMembershipId,
        teamId,
        userId,
        now,
        now,
        now,
        expectedWorkosMembershipId,
        teamId,
        userId,
      ),
  ])
  return (results[0]?.meta.changes ?? 0) > 0
}

export async function countPendingTeamInvitations(db: D1Database, teamId: string): Promise<number> {
  const row = await db
    .prepare(
      "/* teams:count-pending-invitations */ SELECT COUNT(*) AS count FROM team_invitations WHERE team_id=? AND status='pending'",
    )
    .bind(teamId)
    .first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function hasTeamMemberWithEmail(
  db: D1Database,
  teamId: string,
  normalizedEmail: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `/* teams:has-member-email */
       SELECT 1 AS present
       FROM team_memberships membership
       JOIN users user ON user.id=membership.user_id
       WHERE membership.team_id=?
         AND lower(trim(user.email))=?
         AND user.deleted_at IS NULL
       LIMIT 1`,
    )
    .bind(teamId, normalizedEmail)
    .first<{ present: number }>()
  return row?.present === 1
}

export async function insertInvitationProjection(
  db: D1Database,
  args: {
    id: string
    teamId: string
    email: string
    desiredRole: 'admin' | 'member'
    invitedByUserId: string
    invitation: WorkosInvitation
  },
): Promise<boolean> {
  const now = Date.now()
  const result = await db
    .prepare(
      `/* teams:insert-invitation */
       INSERT INTO team_invitations
         (id, workos_invitation_id, team_id, email, desired_role, status,
          invited_by_user_id, accepted_workos_user_id, expires_at, accepted_at,
          revoked_at, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE (
         SELECT COUNT(*) FROM team_invitations
         WHERE team_id=? AND status='pending'
       ) < ?
         AND (
           (SELECT COUNT(*) FROM team_memberships WHERE team_id=?) +
           (SELECT COUNT(*) FROM team_invitations WHERE team_id=? AND status='pending')
         ) < ?
         AND EXISTS (
           SELECT 1 FROM team_memberships actor
           WHERE actor.team_id=? AND actor.user_id=?
             AND actor.role IN ('owner','admin')
         )`,
    )
    .bind(
      args.id,
      args.invitation.id,
      args.teamId,
      args.email,
      args.desiredRole,
      workosInvitationStatus(args.invitation),
      args.invitedByUserId,
      args.invitation.accepted_user_id ?? null,
      timestamp(args.invitation.expires_at),
      timestamp(args.invitation.accepted_at),
      timestamp(args.invitation.revoked_at),
      timestamp(args.invitation.created_at) ?? now,
      timestamp(args.invitation.updated_at) ?? now,
      args.teamId,
      MAX_PENDING_INVITATIONS_PER_TEAM,
      args.teamId,
      args.teamId,
      MAX_TEAM_MEMBERS_AND_PENDING,
      args.teamId,
      args.invitedByUserId,
    )
    .run()
  return result.meta.changes > 0
}

export async function createLocalInvitation(
  db: D1Database,
  args: {
    id: string
    teamId: string
    email: string
    desiredRole: 'admin' | 'member'
    invitedByUserId: string
    idempotencyKey: string
    invitation: WorkosInvitation
    now: number
  },
): Promise<boolean> {
  const results = await db.batch([
    db
      .prepare(
        `/* teams:create-invitation */
         INSERT OR IGNORE INTO team_invitations
           (id, workos_invitation_id, team_id, email, desired_role, status,
            invited_by_user_id, accepted_workos_user_id, expires_at, accepted_at,
            revoked_at, created_at, updated_at)
         SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM team_invitation_requests request
           WHERE request.team_id=? AND request.invited_by_user_id=?
             AND request.idempotency_key=? AND request.invitation_id=?
             AND request.normalized_email=? AND request.desired_role=?
             AND request.status='pending' AND request.workos_invitation_id=?
         )
           AND (
             SELECT COUNT(*) FROM team_invitations
             WHERE team_id=? AND status='pending'
           ) < ?
           AND (
             (SELECT COUNT(*) FROM team_memberships WHERE team_id=?) +
             (SELECT COUNT(*) FROM team_invitations WHERE team_id=? AND status='pending')
           ) < ?
           AND EXISTS (
             SELECT 1 FROM team_memberships actor
             JOIN users actor_user ON actor_user.id=actor.user_id
             WHERE actor.team_id=? AND actor.user_id=?
               AND actor.role IN ('owner','admin')
               AND actor_user.deleted_at IS NULL
               AND actor_user.deletion_pending_until IS NULL
           )
           AND NOT EXISTS (
             SELECT 1 FROM team_memberships existing
             JOIN users existing_user ON existing_user.id=existing.user_id
             WHERE existing.team_id=?
               AND lower(trim(existing_user.email))=?
               AND existing_user.deleted_at IS NULL
               AND NOT (
                 ?='accepted' AND ? IS NOT NULL AND EXISTS (
                   SELECT 1 FROM user_identities identity
                   WHERE identity.user_id=existing.user_id
                     AND identity.provider='workos' AND identity.provider_sub=?
                 )
               )
           )`,
      )
      .bind(
        args.id,
        args.invitation.id,
        args.teamId,
        args.email,
        args.desiredRole,
        workosInvitationStatus(args.invitation),
        args.invitedByUserId,
        args.invitation.accepted_user_id ?? null,
        timestamp(args.invitation.expires_at),
        timestamp(args.invitation.accepted_at),
        timestamp(args.invitation.revoked_at),
        timestamp(args.invitation.created_at) ?? args.now,
        timestamp(args.invitation.updated_at) ?? args.now,
        args.teamId,
        args.invitedByUserId,
        args.idempotencyKey,
        args.id,
        args.email,
        args.desiredRole,
        args.invitation.id,
        args.teamId,
        MAX_PENDING_INVITATIONS_PER_TEAM,
        args.teamId,
        args.teamId,
        MAX_TEAM_MEMBERS_AND_PENDING,
        args.teamId,
        args.invitedByUserId,
        args.teamId,
        args.email,
        workosInvitationStatus(args.invitation),
        args.invitation.accepted_user_id ?? null,
        args.invitation.accepted_user_id ?? null,
      ),
    db
      .prepare(
        `/* teams:complete-invitation-creation-request */
         UPDATE team_invitation_requests
         SET status='completed', workos_invitation_id=?, updated_at=?
         WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?
           AND invitation_id=? AND status='pending'
           AND EXISTS (
             SELECT 1 FROM team_invitations invitation
             WHERE invitation.id=? AND invitation.team_id=?
               AND invitation.workos_invitation_id=?
           )`,
      )
      .bind(
        args.invitation.id,
        args.now,
        args.teamId,
        args.invitedByUserId,
        args.idempotencyKey,
        args.id,
        args.id,
        args.teamId,
        args.invitation.id,
      ),
    db
      .prepare(
        `/* teams:apply-accepted-invitation-role */
         UPDATE team_memberships
         SET role=CASE
               WHEN role='member' AND EXISTS (
                 SELECT 1 FROM team_invitations invitation
                 WHERE invitation.id=? AND invitation.team_id=team_memberships.team_id
                   AND invitation.desired_role='admin'
               ) THEN 'admin'
               ELSE role
             END,
             updated_at=?
         WHERE team_id=?
           AND EXISTS (
             SELECT 1 FROM team_invitations invitation
             JOIN user_identities identity ON identity.user_id=team_memberships.user_id
             WHERE invitation.id=? AND invitation.team_id=team_memberships.team_id
               AND invitation.workos_invitation_id=? AND invitation.status='accepted'
               AND invitation.accepted_workos_user_id=identity.provider_sub
               AND identity.provider='workos'
           )`,
      )
      .bind(args.id, args.now, args.teamId, args.id, args.invitation.id),
  ])
  return (results[0]?.meta.changes ?? 0) > 0 && (results[1]?.meta.changes ?? 0) > 0
}

export async function getTeamInvitation(
  db: D1Database,
  teamId: string,
  invitationId: string,
): Promise<TeamInvitationRow | null> {
  return db
    .prepare('/* teams:get-invitation */ SELECT * FROM team_invitations WHERE team_id=? AND id=?')
    .bind(teamId, invitationId)
    .first<TeamInvitationRow>()
}

export async function getTeamInvitationResponse(
  db: D1Database,
  teamId: string,
  invitationId: string,
): Promise<TeamInvitationResponse | null> {
  const row = await getTeamInvitation(db, teamId, invitationId)
  return row ? invitationResponse(row) : null
}

export async function listTeamInvitations(
  db: D1Database,
  teamId: string,
): Promise<TeamInvitationResponse[]> {
  const result = await db
    .prepare(
      '/* teams:list-invitations */ SELECT * FROM team_invitations WHERE team_id=? ORDER BY created_at DESC LIMIT ?',
    )
    .bind(teamId, MAX_TEAM_INVITATION_LIST_RESULTS)
    .all<TeamInvitationRow>()
  return result.results.map(invitationResponse)
}

export async function updateInvitationProjection(
  db: D1Database,
  teamId: string,
  invitation: WorkosInvitation,
): Promise<void> {
  const now = Date.now()
  await db
    .prepare(
      `/* teams:update-invitation */
       UPDATE team_invitations
       SET status=?, accepted_workos_user_id=?, expires_at=?, accepted_at=?, revoked_at=?, updated_at=?
       WHERE team_id=? AND workos_invitation_id=?`,
    )
    .bind(
      workosInvitationStatus(invitation),
      invitation.accepted_user_id ?? null,
      timestamp(invitation.expires_at),
      timestamp(invitation.accepted_at),
      timestamp(invitation.revoked_at),
      timestamp(invitation.updated_at) ?? now,
      teamId,
      invitation.id,
    )
    .run()
}

export async function reconcileInvitationProjections(
  db: D1Database,
  teamId: string,
  invitations: readonly WorkosInvitation[],
): Promise<void> {
  if (invitations.length === 0) return
  // Keep D1 batches well below platform statement limits even when WorkOS
  // history spans many cursor pages.
  for (let offset = 0; offset < invitations.length; offset += 50) {
    await db.batch(
      invitations.slice(offset, offset + 50).map((invitation) =>
        db
          .prepare(
            `/* teams:reconcile-invitation */
             UPDATE team_invitations
             SET status=?, accepted_workos_user_id=?, expires_at=?, accepted_at=?, revoked_at=?, updated_at=?
             WHERE team_id=? AND workos_invitation_id=?`,
          )
          .bind(
            workosInvitationStatus(invitation),
            invitation.accepted_user_id ?? null,
            timestamp(invitation.expires_at),
            timestamp(invitation.accepted_at),
            timestamp(invitation.revoked_at),
            timestamp(invitation.updated_at) ?? Date.now(),
            teamId,
            invitation.id,
          ),
      ),
    )
  }

  // WorkOS can deliver and the invitee can accept before the inviter's D1
  // projection commits. Recover such rows from the pre-network request ledger
  // before membership sync chooses a role, preserving an intended admin grant
  // instead of silently falling back to member.
  const pending = await listPendingTeamInvitationCreationRequests(db, teamId)
  const used = new Set<string>()
  for (const request of pending) {
    // An email is not a resource identity: it may point at an older accepted
    // invitation or another concurrent request. Only a WorkOS id durably
    // recorded by this request may be adopted or compensated.
    const upstream = invitations.find(
      (invitation) => !used.has(invitation.id) && request.workos_invitation_id === invitation.id,
    )
    if (!upstream) continue
    used.add(upstream.id)
    await recoverTeamInvitationCreationProjection(db, request, upstream)
  }
}

async function listPendingTeamInvitationCreationRequests(
  db: D1Database,
  teamId: string,
): Promise<TeamInvitationCreationRequestRow[]> {
  const requests: TeamInvitationCreationRequestRow[] = []
  let after = ''
  while (true) {
    const page = await db
      .prepare(
        `/* teams:list-pending-invitation-creation-requests */
         SELECT * FROM team_invitation_requests
         WHERE team_id=? AND status='pending' AND invitation_id>?
         ORDER BY invitation_id ASC
         LIMIT 500`,
      )
      .bind(teamId, after)
      .all<TeamInvitationCreationRequestRow>()
    requests.push(...page.results)
    if (page.results.length < 500) return requests
    const next = page.results.at(-1)?.invitation_id
    if (!next || next <= after) {
      throw new ApiError('INTERNAL', 'invalid pending invitation request pagination')
    }
    after = next
  }
}

async function recoverTeamInvitationCreationProjection(
  db: D1Database,
  request: TeamInvitationCreationRequestRow,
  invitation: WorkosInvitation,
): Promise<void> {
  const now = Date.now()
  await db.batch([
    db
      .prepare(
        `/* teams:recover-invitation-creation-projection */
         INSERT OR IGNORE INTO team_invitations
           (id, workos_invitation_id, team_id, email, desired_role, status,
            invited_by_user_id, accepted_workos_user_id, expires_at, accepted_at,
            revoked_at, created_at, updated_at)
         SELECT request.invitation_id, ?, request.team_id,
                request.normalized_email, request.desired_role, ?,
                request.invited_by_user_id, ?, ?, ?, ?, ?, ?
         FROM team_invitation_requests request
         WHERE request.team_id=? AND request.invited_by_user_id=?
           AND request.idempotency_key=? AND request.status='pending'
           AND (request.workos_invitation_id IS NULL OR request.workos_invitation_id=?)`,
      )
      .bind(
        invitation.id,
        workosInvitationStatus(invitation),
        invitation.accepted_user_id ?? null,
        timestamp(invitation.expires_at),
        timestamp(invitation.accepted_at),
        timestamp(invitation.revoked_at),
        timestamp(invitation.created_at) ?? now,
        timestamp(invitation.updated_at) ?? now,
        request.team_id,
        request.invited_by_user_id,
        request.idempotency_key,
        invitation.id,
      ),
    db
      .prepare(
        `/* teams:complete-recovered-invitation-creation */
         UPDATE team_invitation_requests
         SET status='completed', workos_invitation_id=?, updated_at=?
         WHERE team_id=? AND invited_by_user_id=? AND idempotency_key=?
           AND status='pending'
           AND EXISTS (
             SELECT 1 FROM team_invitations projected
             WHERE projected.id=team_invitation_requests.invitation_id
               AND projected.team_id=team_invitation_requests.team_id
               AND projected.workos_invitation_id=?
           )`,
      )
      .bind(
        invitation.id,
        now,
        request.team_id,
        request.invited_by_user_id,
        request.idempotency_key,
        invitation.id,
      ),
    db
      .prepare(
        `/* teams:apply-recovered-invitation-role */
         UPDATE team_memberships
         SET role=CASE
               WHEN role='member' AND ?='admin' THEN 'admin'
               ELSE role
             END,
             updated_at=?
         WHERE team_id=?
           AND EXISTS (
             SELECT 1 FROM user_identities identity
             WHERE identity.user_id=team_memberships.user_id
               AND identity.provider='workos' AND identity.provider_sub=?
           )
           AND EXISTS (
             SELECT 1 FROM team_invitations projected
             WHERE projected.id=? AND projected.team_id=team_memberships.team_id
               AND projected.workos_invitation_id=? AND projected.status='accepted'
           )`,
      )
      .bind(
        request.desired_role,
        now,
        request.team_id,
        invitation.accepted_user_id ?? '',
        request.invitation_id,
        invitation.id,
      ),
  ])
}

export async function syncLocalMembership(
  db: D1Database,
  args: {
    userId: string
    email: string
    team: TeamRow
    membership: WorkosMembership
    now: number
    skipInvitationLookup?: boolean
  },
): Promise<void> {
  const membershipVersion = timestamp(args.membership.updated_at)
  const exactDenial = await db
    .prepare(
      `/* teams:get-membership-denial */
       SELECT reason, workos_updated_at, previous_role
       FROM workos_membership_denials
       WHERE organization_id=? AND membership_id=? AND workos_user_id=?`,
    )
    .bind(args.team.workos_organization_id, args.membership.id, args.membership.user_id)
    .first<{
      reason: 'deleted' | 'inactive'
      workos_updated_at: number | null
      previous_role: TeamRole | null
    }>()
  const denialSuperseded =
    exactDenial?.reason === 'inactive' &&
    membershipVersion !== null &&
    exactDenial.workos_updated_at !== null &&
    membershipVersion > exactDenial.workos_updated_at
  if (exactDenial && !denialSuperseded) return

  const block = await db
    .prepare(
      '/* teams:get-block */ SELECT blocked_at FROM team_membership_blocks WHERE team_id=? AND (user_id=? OR workos_user_id=?) ORDER BY blocked_at DESC LIMIT 1',
    )
    .bind(args.team.id, args.userId, args.membership.user_id)
    .first<{ blocked_at: number }>()
  const invitation = args.skipInvitationLookup
    ? null
    : await db
        .prepare(
          `/* teams:sync-invitation */
           SELECT * FROM team_invitations
           WHERE team_id=? AND (accepted_workos_user_id=? OR email=?)
             AND status='accepted'
           ORDER BY CASE WHEN accepted_workos_user_id=? THEN 0 ELSE 1 END,
                    created_at DESC LIMIT 1`,
        )
        .bind(args.team.id, args.membership.user_id, args.email, args.membership.user_id)
        .first<TeamInvitationRow>()

  // A newer explicit invitation is the only action that may supersede a
  // local removal tombstone, and it must already be accepted by this exact
  // WorkOS user. A pending invite plus a stale upstream membership must never
  // revive access before acceptance.
  const invitationAcceptedByMembership =
    invitation?.status === 'accepted' &&
    invitation.accepted_workos_user_id === args.membership.user_id
  const invitationSupersedesBlock =
    invitationAcceptedByMembership && (block === null || invitation.created_at > block.blocked_at)
  if (block && !invitationSupersedesBlock) return

  const current = await getTeamMembership(db, args.team.id, args.userId)
  const desiredRole =
    current?.role ??
    (invitationAcceptedByMembership
      ? invitation.desired_role
      : denialSuperseded
        ? (exactDenial.previous_role ?? 'member')
        : 'member')
  const acceptedInvitationId = invitationAcceptedByMembership ? invitation.id : ''
  const statements = [
    db
      .prepare(
        `/* teams:sync-membership */
         INSERT INTO team_memberships
           (team_id, user_id, role, workos_membership_id, workos_updated_at, joined_at, updated_at)
         SELECT ?,?,?,?,?,?,?
         WHERE (
           EXISTS (
             SELECT 1 FROM team_memberships current
             WHERE current.team_id=? AND current.user_id=?
           ) OR (
             (SELECT COUNT(*) FROM team_memberships WHERE team_id=?) +
             (SELECT COUNT(*) FROM team_invitations WHERE team_id=? AND status='pending')
           ) < ?
         )
         AND EXISTS (
           SELECT 1 FROM users live_user
           WHERE live_user.id=? AND live_user.deleted_at IS NULL
             AND live_user.deletion_pending_until IS NULL
         )
         AND (
           NOT EXISTS (
             SELECT 1 FROM workos_membership_denials denied
             WHERE denied.organization_id=? AND denied.membership_id=?
               AND denied.workos_user_id=?
           ) OR EXISTS (
             SELECT 1 FROM workos_membership_denials denied
             WHERE denied.organization_id=? AND denied.membership_id=?
               AND denied.workos_user_id=? AND denied.reason='inactive'
               AND ? IS NOT NULL AND denied.workos_updated_at<?
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM workos_user_denials denied_user
           WHERE denied_user.workos_user_id=?
         )
         AND (
           NOT EXISTS (
             SELECT 1 FROM team_membership_blocks block
             WHERE block.team_id=? AND (block.user_id=? OR block.workos_user_id=?)
           ) OR EXISTS (
             SELECT 1 FROM team_invitations accepted
             WHERE accepted.id=? AND accepted.team_id=? AND accepted.status='accepted'
               AND accepted.accepted_workos_user_id=?
               AND accepted.created_at>(
                 SELECT MAX(block.blocked_at) FROM team_membership_blocks block
                 WHERE block.team_id=? AND (block.user_id=? OR block.workos_user_id=?)
               )
           )
         )
         AND (
           EXISTS (
             SELECT 1 FROM team_memberships current
             WHERE current.team_id=? AND current.user_id=?
           ) OR ?='member' OR EXISTS (
             SELECT 1 FROM team_invitations accepted
             WHERE accepted.id=? AND accepted.team_id=? AND accepted.status='accepted'
               AND accepted.accepted_workos_user_id=?
               AND accepted.desired_role=?
           )
         )
         ON CONFLICT(team_id,user_id) DO UPDATE SET
           workos_membership_id=excluded.workos_membership_id,
           workos_updated_at=excluded.workos_updated_at,
           updated_at=excluded.updated_at`,
      )
      .bind(
        args.team.id,
        args.userId,
        desiredRole,
        args.membership.id,
        timestamp(args.membership.updated_at),
        args.now,
        args.now,
        args.team.id,
        args.userId,
        args.team.id,
        args.team.id,
        MAX_TEAM_MEMBERS_AND_PENDING,
        args.userId,
        args.team.workos_organization_id,
        args.membership.id,
        args.membership.user_id,
        args.team.workos_organization_id,
        args.membership.id,
        args.membership.user_id,
        membershipVersion,
        membershipVersion,
        args.membership.user_id,
        args.team.id,
        args.userId,
        args.membership.user_id,
        acceptedInvitationId,
        args.team.id,
        args.membership.user_id,
        args.team.id,
        args.userId,
        args.membership.user_id,
        args.team.id,
        args.userId,
        desiredRole,
        acceptedInvitationId,
        args.team.id,
        args.membership.user_id,
        desiredRole,
      ),
    db
      .prepare(
        `/* teams:clear-superseded-membership-denial */
         DELETE FROM workos_membership_denials
         WHERE organization_id=? AND membership_id=? AND workos_user_id=?
           AND reason='inactive' AND ? IS NOT NULL AND workos_updated_at<?
           AND EXISTS (
             SELECT 1 FROM users live_user
             WHERE live_user.id=? AND live_user.deleted_at IS NULL
               AND live_user.deletion_pending_until IS NULL
           )
           AND EXISTS (
             SELECT 1 FROM team_memberships current
             WHERE current.team_id=? AND current.user_id=?
               AND current.workos_membership_id=? AND current.workos_updated_at>=?
           )`,
      )
      .bind(
        args.team.workos_organization_id,
        args.membership.id,
        args.membership.user_id,
        membershipVersion,
        membershipVersion,
        args.userId,
        args.team.id,
        args.userId,
        args.membership.id,
        membershipVersion,
      ),
  ]
  if (invitationSupersedesBlock) {
    statements.push(
      db
        .prepare(
          `/* teams:clear-block */
           DELETE FROM team_membership_blocks
           WHERE team_id=? AND (user_id=? OR workos_user_id=?)
             AND EXISTS (
               SELECT 1 FROM users live_user
               WHERE live_user.id=? AND live_user.deleted_at IS NULL
                 AND live_user.deletion_pending_until IS NULL
             )
             AND EXISTS (
               SELECT 1 FROM team_memberships current
               WHERE current.team_id=? AND current.user_id=?
                 AND current.workos_membership_id=?
             )
             AND EXISTS (
               SELECT 1 FROM team_invitations accepted
               WHERE accepted.id=? AND accepted.team_id=? AND accepted.status='accepted'
                 AND accepted.accepted_workos_user_id=?
                 AND accepted.created_at>team_membership_blocks.blocked_at
             )`,
        )
        .bind(
          args.team.id,
          args.userId,
          args.membership.user_id,
          args.userId,
          args.team.id,
          args.userId,
          args.membership.id,
          acceptedInvitationId,
          args.team.id,
          args.membership.user_id,
        ),
    )
  }
  if (invitationAcceptedByMembership) {
    statements.push(
      db
        .prepare(
          `/* teams:accept-invitation */
           UPDATE team_invitations
           SET status='accepted', accepted_workos_user_id=?,
               accepted_at=COALESCE(accepted_at,?), updated_at=?
           WHERE id=?
             AND EXISTS (
               SELECT 1 FROM users live_user
               WHERE live_user.id=? AND live_user.deleted_at IS NULL
                 AND live_user.deletion_pending_until IS NULL
             )
             AND EXISTS (
             SELECT 1 FROM team_memberships current
             WHERE current.team_id=team_invitations.team_id AND current.user_id=?
               AND current.workos_membership_id=?
           )`,
        )
        .bind(
          args.membership.user_id,
          args.now,
          args.now,
          invitation.id,
          args.userId,
          args.userId,
          args.membership.id,
        ),
    )
  }
  await db.batch(statements)
}

function teamResponse(row: TeamListRow): TeamResponse {
  const permissions = permissionsForRole(row.role)
  return {
    id: row.id,
    name: row.name,
    handle: row.handle ?? null,
    role: row.role,
    // The final owner cannot leave without first transferring ownership. Keep
    // the server-computed capability contract aligned with that invariant so
    // every client can render the same truthful action set.
    permissions:
      row.role === 'owner' && Number(row.owner_count) <= 1
        ? permissions.filter((permission) => permission !== 'team:leave')
        : permissions,
    member_count: Number(row.member_count),
    archived_at: row.archived_at,
  }
}

export function memberPermissions(
  actor: TeamMembershipRow,
  target: TeamMembershipRow,
  ownerCount: number,
): TeamMemberPermission[] {
  if (actor.user_id === target.user_id) return []
  if (actor.role === 'admin') {
    return target.role === 'member' ? ['role:update', 'remove'] : []
  }
  if (actor.role !== 'owner') return []

  const canDisplace = target.role !== 'owner' || ownerCount > 1
  if (!canDisplace) return []
  return [
    'role:update',
    'remove',
    ...(target.role === 'owner' ? [] : (['ownership:transfer'] as const)),
  ]
}

function invitationResponse(row: TeamInvitationRow): TeamInvitationResponse {
  return {
    id: row.id,
    email: row.email,
    role: row.desired_role,
    status: row.status,
    ...(row.expires_at === null ? {} : { expires_at: row.expires_at }),
  }
}

function workosInvitationStatus(invitation: WorkosInvitation): TeamInvitationRow['status'] {
  return invitation.state
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

import type { D1Database } from '@cloudflare/workers-types'
import { z } from 'zod'

import { ApiError } from '../errors'

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024
const MAX_SIGNATURE_HEADER_BYTES = 4 * 1024
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000

const EventEnvelope = z
  .object({
    id: z.string().min(1).max(255),
    event: z.string().min(1).max(255),
    created_at: z.string(),
    data: z.unknown(),
  })
  .passthrough()

const MembershipData = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    organization_id: z.string().min(1),
    status: z.enum(['active', 'inactive', 'pending']),
    updated_at: z.iso.datetime().optional(),
  })
  .passthrough()

const OrganizationData = z.object({ id: z.string().min(1) }).passthrough()
const UserData = z.object({ id: z.string().min(1) }).passthrough()

export type VerifiedWorkosEvent = z.infer<typeof EventEnvelope>

export async function verifyWorkosWebhook(
  request: Request,
  secret: string | undefined,
  now = Date.now(),
): Promise<VerifiedWorkosEvent> {
  if (!secret) throw new ApiError('NOT_FOUND')
  const signatureHeader = request.headers.get('workos-signature') ?? ''
  if (!signatureHeader || signatureHeader.length > MAX_SIGNATURE_HEADER_BYTES) {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS signature')
  }
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader)
  if (Math.abs(now - timestamp) > SIGNATURE_TOLERANCE_MS) {
    throw new ApiError('BAD_REQUEST', 'stale WorkOS signature')
  }

  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > MAX_WEBHOOK_BODY_BYTES) {
    throw new ApiError('BAD_REQUEST', 'WorkOS webhook body too large')
  }
  const raw = await readBoundedRequestBody(request, MAX_WEBHOOK_BODY_BYTES)
  let body: string
  try {
    body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw)
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS webhook encoding')
  }

  const encoder = new TextEncoder()
  const signedPayload = encoder.encode(`${timestamp}.${body}`)
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  let valid = false
  for (const signature of signatures) {
    valid ||= await crypto.subtle.verify('HMAC', key, signature, signedPayload)
  }
  if (!valid) throw new ApiError('BAD_REQUEST', 'invalid WorkOS signature')

  let json: unknown
  try {
    json = JSON.parse(body) as unknown
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS webhook JSON')
  }
  const parsed = EventEnvelope.safeParse(json)
  if (!parsed.success || parseTimestamp(parsed.data.created_at) === null) {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS webhook event')
  }
  return parsed.data
}

async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ApiError('BAD_REQUEST', 'WorkOS webhook body too large')
    }
    chunks.push(value)
  }
  const raw = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    raw.set(chunk, offset)
    offset += chunk.byteLength
  }
  return raw
}

export async function processWorkosWebhookEvent(
  db: D1Database,
  event: VerifiedWorkosEvent,
  now = Date.now(),
): Promise<void> {
  const createdAt = requireTimestamp(event.created_at)
  const inserted = await db
    .prepare(
      `/* workos-webhook:receive */
       INSERT OR IGNORE INTO workos_webhook_events
         (event_id, event_type, event_created_at, received_at, processed_at)
       VALUES (?,?,?,?,NULL)`,
    )
    .bind(event.id, event.event, createdAt, now)
    .run()
  if ((inserted.meta.changes ?? 0) === 0) {
    const existing = await db
      .prepare('SELECT processed_at FROM workos_webhook_events WHERE event_id=?')
      .bind(event.id)
      .first<{ processed_at: number | null }>()
    if (existing?.processed_at !== null && existing?.processed_at !== undefined) return
  }

  if (event.event === 'organization_membership.deleted') {
    const data = parseMembershipData(event.data)
    await revokeLocalWorkosMembership(db, {
      eventId: event.id,
      eventType: event.event,
      membershipId: data.id,
      workosUserId: data.user_id,
      organizationId: data.organization_id,
      workosUpdatedAt: data.updated_at ? requireTimestamp(data.updated_at) : createdAt,
      now,
    })
  } else if (event.event === 'organization_membership.updated') {
    const data = parseMembershipData(event.data)
    if (data.status === 'inactive') {
      await revokeLocalWorkosMembership(db, {
        eventId: event.id,
        eventType: event.event,
        membershipId: data.id,
        workosUserId: data.user_id,
        organizationId: data.organization_id,
        workosUpdatedAt: data.updated_at ? requireTimestamp(data.updated_at) : createdAt,
        now,
      })
    } else if (data.status === 'active') {
      await restoreInactiveWorkosMembership(db, {
        membershipId: data.id,
        workosUserId: data.user_id,
        organizationId: data.organization_id,
        workosUpdatedAt: data.updated_at ? requireTimestamp(data.updated_at) : createdAt,
        now,
      })
    }
  } else if (event.event === 'organization.deleted') {
    const data = OrganizationData.safeParse(event.data)
    if (!data.success) throw new ApiError('BAD_REQUEST', 'invalid WorkOS organization event')
    await archiveOrganization(db, event.id, data.data.id, now)
  } else if (event.event === 'user.deleted') {
    const data = UserData.safeParse(event.data)
    if (!data.success) throw new ApiError('BAD_REQUEST', 'invalid WorkOS user event')
    await revokeDeletedUserMemberships(db, event.id, data.data.id, now)
  }

  await db
    .prepare(
      '/* workos-webhook:complete */ UPDATE workos_webhook_events SET processed_at=? WHERE event_id=? AND processed_at IS NULL',
    )
    .bind(now, event.id)
    .run()
}

async function revokeDeletedUserMemberships(
  db: D1Database,
  eventId: string,
  workosUserId: string,
  now: number,
): Promise<void> {
  // This is deliberately set-based rather than LIMIT/loop based. A deleted
  // WorkOS user must lose every Team grant in one bounded D1 transaction,
  // even if they belong to more than one result page of Organizations.
  await db.batch([
    db
      .prepare(
        `/* workos-webhook:deny-user */
         INSERT INTO workos_user_denials (workos_user_id, denied_at, event_id)
         VALUES (?,?,?)
         ON CONFLICT(workos_user_id) DO UPDATE SET
           denied_at=MAX(workos_user_denials.denied_at, excluded.denied_at),
           event_id=CASE
             WHEN excluded.denied_at>=workos_user_denials.denied_at THEN excluded.event_id
             ELSE workos_user_denials.event_id
           END`,
      )
      .bind(workosUserId, now, eventId),
    db
      .prepare(
        `/* workos-webhook:user-archive-last-owner */
         UPDATE teams SET archived_at=?, deletion_pending_until=NULL, updated_at=?
         WHERE archived_at IS NULL
           AND (
             EXISTS (
               SELECT 1 FROM team_memberships m
               JOIN user_identities identity ON identity.user_id=m.user_id
               WHERE m.team_id=teams.id AND m.role='owner'
                 AND identity.provider='workos' AND identity.provider_sub=?
             ) OR EXISTS (
               SELECT 1 FROM workos_membership_denials denied
               WHERE denied.team_id=teams.id AND denied.previous_role='owner'
                 AND denied.workos_user_id=?
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM team_memberships other
             WHERE other.team_id=teams.id AND other.role='owner'
               AND other.user_id NOT IN (
                 SELECT user_id FROM user_identities
                 WHERE provider='workos' AND provider_sub=?
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM workos_membership_denials other_denied
             WHERE other_denied.team_id=teams.id AND other_denied.previous_role='owner'
               AND other_denied.reason='inactive' AND other_denied.workos_user_id<>?
           )`,
      )
      .bind(now, now, workosUserId, workosUserId, workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-audit-last-owner */
         INSERT INTO audit_log
           (user_id, ip_hash, ua_hash, action, target_id, details_json, ts)
         SELECT NULL, 'workos', 'workos', 'team.archived.workos', id,
                json_object('event_id', ?, 'event_type', 'user.deleted'), ?
         FROM teams
         WHERE archived_at=? AND (
           EXISTS (
             SELECT 1 FROM team_memberships m
             JOIN user_identities identity ON identity.user_id=m.user_id
             WHERE m.team_id=teams.id AND identity.provider='workos'
               AND identity.provider_sub=?
           ) OR EXISTS (
             SELECT 1 FROM workos_membership_denials denied
             WHERE denied.team_id=teams.id AND denied.workos_user_id=?
           )
         )`,
      )
      .bind(eventId, now, now, workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-private-sessions */
         UPDATE hub_sessions SET visibility='private', updated_at=?
         WHERE team_id IN (
           SELECT t.id FROM teams t
           WHERE t.archived_at=? AND (
             EXISTS (
               SELECT 1 FROM team_memberships m
               JOIN user_identities identity ON identity.user_id=m.user_id
               WHERE m.team_id=t.id AND identity.provider='workos'
                 AND identity.provider_sub=?
             ) OR EXISTS (
               SELECT 1 FROM workos_membership_denials denied
               WHERE denied.team_id=t.id AND denied.workos_user_id=?
             )
           )
         )`,
      )
      .bind(now, now, workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-delete-engagement */
         DELETE FROM hub_session_engagement_daily
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.archived_at=? AND (
             EXISTS (
               SELECT 1 FROM team_memberships m
               JOIN user_identities identity ON identity.user_id=m.user_id
               WHERE m.team_id=t.id AND identity.provider='workos'
                 AND identity.provider_sub=?
             ) OR EXISTS (
               SELECT 1 FROM workos_membership_denials denied
               WHERE denied.team_id=t.id AND denied.workos_user_id=?
             )
           )
         )`,
      )
      .bind(now, workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-delete-discovery */
         DELETE FROM hub_session_discovery
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.archived_at=? AND (
             EXISTS (
               SELECT 1 FROM team_memberships m
               JOIN user_identities identity ON identity.user_id=m.user_id
               WHERE m.team_id=t.id AND identity.provider='workos'
                 AND identity.provider_sub=?
             ) OR EXISTS (
               SELECT 1 FROM workos_membership_denials denied
               WHERE denied.team_id=t.id AND denied.workos_user_id=?
             )
           )
         )`,
      )
      .bind(now, workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-replace-blocks */
         DELETE FROM team_membership_blocks
         WHERE workos_user_id=? AND user_id NOT IN (
           SELECT user_id FROM user_identities
           WHERE provider='workos' AND provider_sub=?
         )`,
      )
      .bind(workosUserId, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-audit-memberships */
         INSERT INTO audit_log
           (user_id, ip_hash, ua_hash, action, target_id, details_json, ts)
         SELECT NULL, 'workos', 'workos', 'team.membership.deprovisioned',
                m.team_id,
                json_object('event_id', ?, 'event_type', 'user.deleted',
                            'member_user_id', m.user_id), ?
         FROM team_memberships m JOIN user_identities identity ON identity.user_id=m.user_id
         WHERE identity.provider='workos' AND identity.provider_sub=?`,
      )
      .bind(eventId, now, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-block-memberships */
         INSERT INTO team_membership_blocks
           (team_id, user_id, workos_user_id, blocked_at, blocked_by_user_id)
         SELECT m.team_id, m.user_id, ?, ?, NULL
         FROM team_memberships m JOIN user_identities identity ON identity.user_id=m.user_id
         WHERE identity.provider='workos' AND identity.provider_sub=?
         ON CONFLICT(team_id,user_id) DO UPDATE SET
           workos_user_id=excluded.workos_user_id,
           blocked_at=MAX(team_membership_blocks.blocked_at, excluded.blocked_at),
           blocked_by_user_id=NULL`,
      )
      .bind(workosUserId, now, workosUserId),
    db
      .prepare(
        `/* workos-webhook:user-delete-memberships */
         DELETE FROM team_memberships
         WHERE user_id IN (
           SELECT user_id FROM user_identities
           WHERE provider='workos' AND provider_sub=?
         )`,
      )
      .bind(workosUserId),
  ])
}

export async function revokeLocalWorkosMembership(
  db: D1Database,
  args: {
    eventId?: string | null
    eventType?: string
    membershipId: string
    workosUserId: string
    organizationId: string
    workosUpdatedAt?: number | null
    now: number
  },
): Promise<void> {
  const eventType = args.eventType ?? 'membership.active_reconcile'
  const reversible = eventType === 'organization_membership.updated'
  const workosVersion = args.workosUpdatedAt ?? args.now
  // Every statement gates on the exact upstream membership id and monotonic
  // WorkOS updated_at so an old, out-of-order delivery cannot revoke a newer
  // active membership projection. A null timestamp is used only by the
  // complete-list reconciliation path and still requires the exact id.
  await db.batch([
    db
      .prepare(
        `/* workos-webhook:deny-membership */
         INSERT INTO workos_membership_denials
           (organization_id, membership_id, workos_user_id, reason,
            workos_updated_at, team_id, user_id, previous_role, denied_at, event_id)
         SELECT ?,?,?,?, ?,
                (SELECT id FROM teams WHERE workos_organization_id=?),
                (SELECT m.user_id FROM team_memberships m JOIN teams t ON t.id=m.team_id
                 WHERE t.workos_organization_id=? AND m.workos_membership_id=?),
                (SELECT m.role FROM team_memberships m JOIN teams t ON t.id=m.team_id
                 WHERE t.workos_organization_id=? AND m.workos_membership_id=?),
                ?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM team_memberships current JOIN teams team ON team.id=current.team_id
           WHERE team.workos_organization_id=? AND current.workos_membership_id=?
             AND current.workos_updated_at>?
         )
         ON CONFLICT(organization_id,membership_id) DO UPDATE SET
           workos_user_id=excluded.workos_user_id,
           reason=excluded.reason,
           workos_updated_at=excluded.workos_updated_at,
           team_id=COALESCE(excluded.team_id,workos_membership_denials.team_id),
           user_id=COALESCE(excluded.user_id,workos_membership_denials.user_id),
           previous_role=COALESCE(excluded.previous_role,workos_membership_denials.previous_role),
           denied_at=excluded.denied_at,
           event_id=excluded.event_id
         WHERE excluded.workos_updated_at>=workos_membership_denials.workos_updated_at`,
      )
      .bind(
        args.organizationId,
        args.membershipId,
        args.workosUserId,
        reversible ? 'inactive' : 'deleted',
        workosVersion,
        args.organizationId,
        args.organizationId,
        args.membershipId,
        args.organizationId,
        args.membershipId,
        args.now,
        args.eventId ?? null,
        args.organizationId,
        args.membershipId,
        workosVersion,
      ),
    db
      .prepare(
        `/* workos-webhook:archive-last-owner */
         UPDATE teams SET archived_at=?, deletion_pending_until=NULL, updated_at=?
         WHERE workos_organization_id=? AND archived_at IS NULL AND ?=0
           AND (
             EXISTS (
               SELECT 1 FROM team_memberships m
               WHERE m.team_id=teams.id AND m.role='owner'
                 AND m.workos_membership_id=?
                 AND (? IS NULL OR m.workos_updated_at IS NULL OR m.workos_updated_at<=?)
             ) OR EXISTS (
               SELECT 1 FROM workos_membership_denials denied
               WHERE denied.team_id=teams.id AND denied.organization_id=?
                 AND denied.membership_id=? AND denied.previous_role='owner'
                 AND denied.reason='deleted'
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM team_memberships other
             WHERE other.team_id=teams.id AND other.role='owner'
               AND (other.workos_membership_id IS NULL OR other.workos_membership_id<>?)
           )
           AND NOT EXISTS (
             SELECT 1 FROM workos_membership_denials other_denied
             WHERE other_denied.team_id=teams.id AND other_denied.previous_role='owner'
               AND other_denied.reason='inactive'
               AND other_denied.membership_id<>?
           )`,
      )
      .bind(
        args.now,
        args.now,
        args.organizationId,
        reversible ? 1 : 0,
        args.membershipId,
        args.workosUpdatedAt ?? null,
        args.workosUpdatedAt ?? null,
        args.organizationId,
        args.membershipId,
        args.membershipId,
        args.membershipId,
      ),
    db
      .prepare(
        `/* workos-webhook:audit-last-owner-archive */
         INSERT INTO audit_log
           (user_id, ip_hash, ua_hash, action, target_id, details_json, ts)
         SELECT NULL, 'workos', 'workos', 'team.archived.workos', id,
                json_object('event_id', ?, 'event_type', ?), ?
         FROM teams WHERE workos_organization_id=? AND archived_at=?`,
      )
      .bind(args.eventId ?? null, eventType, args.now, args.organizationId, args.now),
    db
      .prepare(
        `/* workos-webhook:archive-last-owner-sessions */
         UPDATE hub_sessions SET visibility='private', updated_at=?
         WHERE team_id IN (
           SELECT id FROM teams WHERE workos_organization_id=? AND archived_at=?
         )`,
      )
      .bind(args.now, args.organizationId, args.now),
    db
      .prepare(
        `/* workos-webhook:archive-last-owner-engagement */
         DELETE FROM hub_session_engagement_daily
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.workos_organization_id=? AND t.archived_at=?
         )`,
      )
      .bind(args.organizationId, args.now),
    db
      .prepare(
        `/* workos-webhook:archive-last-owner-discovery */
         DELETE FROM hub_session_discovery
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.workos_organization_id=? AND t.archived_at=?
         )`,
      )
      .bind(args.organizationId, args.now),
    db
      .prepare(
        `/* workos-webhook:replace-block */
         DELETE FROM team_membership_blocks
         WHERE team_id=(SELECT id FROM teams WHERE workos_organization_id=?)
           AND ?=0
           AND workos_user_id=?
           AND user_id<>(
             SELECT m.user_id FROM team_memberships m
             JOIN teams t ON t.id=m.team_id
             WHERE t.workos_organization_id=? AND m.workos_membership_id=?
               AND (? IS NULL OR m.workos_updated_at IS NULL OR m.workos_updated_at<=?)
           )`,
      )
      .bind(
        args.organizationId,
        reversible ? 1 : 0,
        args.workosUserId,
        args.organizationId,
        args.membershipId,
        args.workosUpdatedAt ?? null,
        args.workosUpdatedAt ?? null,
      ),
    db
      .prepare(
        `/* workos-webhook:audit-membership-deprovision */
         INSERT INTO audit_log
           (user_id, ip_hash, ua_hash, action, target_id, details_json, ts)
         SELECT NULL, 'workos', 'workos', 'team.membership.deprovisioned',
                m.team_id,
                json_object('event_id', ?, 'event_type', ?, 'member_user_id', m.user_id), ?
         FROM team_memberships m JOIN teams t ON t.id=m.team_id
         WHERE t.workos_organization_id=? AND m.workos_membership_id=?
           AND (? IS NULL OR m.workos_updated_at IS NULL OR m.workos_updated_at<=?)`,
      )
      .bind(
        args.eventId ?? null,
        eventType,
        args.now,
        args.organizationId,
        args.membershipId,
        args.workosUpdatedAt ?? null,
        args.workosUpdatedAt ?? null,
      ),
    db
      .prepare(
        `/* workos-webhook:block-membership */
         INSERT INTO team_membership_blocks
           (team_id, user_id, workos_user_id, blocked_at, blocked_by_user_id)
         SELECT m.team_id, m.user_id, ?, ?, NULL
         FROM team_memberships m JOIN teams t ON t.id=m.team_id
         WHERE ?=0 AND t.workos_organization_id=? AND m.workos_membership_id=?
           AND (? IS NULL OR m.workos_updated_at IS NULL OR m.workos_updated_at<=?)
         ON CONFLICT(team_id,user_id) DO UPDATE SET
           workos_user_id=excluded.workos_user_id,
           blocked_at=MAX(team_membership_blocks.blocked_at, excluded.blocked_at),
           blocked_by_user_id=NULL`,
      )
      .bind(
        args.workosUserId,
        args.now,
        reversible ? 1 : 0,
        args.organizationId,
        args.membershipId,
        args.workosUpdatedAt ?? null,
        args.workosUpdatedAt ?? null,
      ),
    db
      .prepare(
        `/* workos-webhook:delete-membership */
         DELETE FROM team_memberships
         WHERE workos_membership_id=?
           AND team_id=(SELECT id FROM teams WHERE workos_organization_id=?)
           AND (? IS NULL OR workos_updated_at IS NULL OR workos_updated_at<=?)`,
      )
      .bind(
        args.membershipId,
        args.organizationId,
        args.workosUpdatedAt ?? null,
        args.workosUpdatedAt ?? null,
      ),
  ])
}

export async function restoreInactiveWorkosMembership(
  db: D1Database,
  args: {
    membershipId: string
    workosUserId: string
    organizationId: string
    workosUpdatedAt: number
    now: number
  },
): Promise<void> {
  // WorkOS can reactivate an inactive Organization membership with the same
  // id. Only a strictly newer upstream version may consume the reversible
  // denial; deleted/local-removal tombstones remain authoritative.
  await db.batch([
    db
      .prepare(
        `/* workos-webhook:restore-inactive-membership */
         INSERT INTO team_memberships
           (team_id, user_id, role, workos_membership_id, workos_updated_at,
            joined_at, updated_at)
         SELECT denied.team_id, denied.user_id,
                COALESCE(denied.previous_role,'member'), ?, ?, ?, ?
         FROM workos_membership_denials denied
         JOIN teams team ON team.id=denied.team_id
         JOIN users user ON user.id=denied.user_id
         WHERE denied.organization_id=? AND denied.membership_id=?
           AND denied.workos_user_id=? AND denied.reason='inactive'
           AND denied.workos_updated_at<?
           AND team.archived_at IS NULL AND team.deletion_pending_until IS NULL
           AND user.deleted_at IS NULL AND user.deletion_pending_until IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM workos_user_denials user_denial
             WHERE user_denial.workos_user_id=denied.workos_user_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM team_membership_blocks block
             WHERE block.team_id=denied.team_id
               AND (block.user_id=denied.user_id OR block.workos_user_id=denied.workos_user_id)
           )
         ON CONFLICT(team_id,user_id) DO UPDATE SET
           workos_membership_id=excluded.workos_membership_id,
           workos_updated_at=excluded.workos_updated_at,
           updated_at=excluded.updated_at
         WHERE team_memberships.workos_updated_at IS NULL
            OR team_memberships.workos_updated_at<excluded.workos_updated_at`,
      )
      .bind(
        args.membershipId,
        args.workosUpdatedAt,
        args.now,
        args.now,
        args.organizationId,
        args.membershipId,
        args.workosUserId,
        args.workosUpdatedAt,
      ),
    db
      .prepare(
        `/* workos-webhook:clear-inactive-denial */
         DELETE FROM workos_membership_denials
         WHERE organization_id=? AND membership_id=? AND workos_user_id=?
           AND reason='inactive' AND workos_updated_at<?
           AND EXISTS (
             SELECT 1 FROM team_memberships current JOIN teams team ON team.id=current.team_id
             WHERE team.workos_organization_id=?
               AND current.workos_membership_id=? AND current.workos_updated_at>=?
           )`,
      )
      .bind(
        args.organizationId,
        args.membershipId,
        args.workosUserId,
        args.workosUpdatedAt,
        args.organizationId,
        args.membershipId,
        args.workosUpdatedAt,
      ),
  ])
}

async function archiveOrganization(
  db: D1Database,
  eventId: string,
  organizationId: string,
  now: number,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `/* workos-webhook:archive-organization */
         UPDATE teams SET archived_at=?, deletion_pending_until=NULL, updated_at=?
         WHERE workos_organization_id=? AND archived_at IS NULL
           AND EXISTS (
             SELECT 1 FROM workos_webhook_events e
             WHERE e.event_id=? AND e.processed_at IS NULL
           )`,
      )
      .bind(now, now, organizationId, eventId),
    db
      .prepare(
        `/* workos-webhook:archive-organization-sessions */
         UPDATE hub_sessions SET visibility='private', updated_at=?
         WHERE team_id IN (
           SELECT id FROM teams WHERE workos_organization_id=? AND archived_at=?
         )`,
      )
      .bind(now, organizationId, now),
    db
      .prepare(
        `/* workos-webhook:audit-organization-archive */
         INSERT INTO audit_log
           (user_id, ip_hash, ua_hash, action, target_id, details_json, ts)
         SELECT NULL, 'workos', 'workos', 'team.archived.workos', id,
                json_object('event_id', ?, 'event_type', 'organization.deleted'), ?
         FROM teams WHERE workos_organization_id=? AND archived_at=?`,
      )
      .bind(eventId, now, organizationId, now),
    db
      .prepare(
        `/* workos-webhook:archive-organization-engagement */
         DELETE FROM hub_session_engagement_daily
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.workos_organization_id=? AND t.archived_at=?
         )`,
      )
      .bind(organizationId, now),
    db
      .prepare(
        `/* workos-webhook:archive-organization-discovery */
         DELETE FROM hub_session_discovery
         WHERE sid IN (
           SELECT s.sid FROM hub_sessions s JOIN teams t ON t.id=s.team_id
           WHERE t.workos_organization_id=? AND t.archived_at=?
         )`,
      )
      .bind(organizationId, now),
  ])
}

function parseMembershipData(value: unknown): z.infer<typeof MembershipData> {
  const parsed = MembershipData.safeParse(value)
  if (!parsed.success) {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS membership event')
  }
  return parsed.data
}

function parseTimestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function requireTimestamp(value: string): number {
  const parsed = parseTimestamp(value)
  if (parsed === null) throw new ApiError('BAD_REQUEST', 'invalid WorkOS event timestamp')
  return parsed
}

function parseSignatureHeader(header: string): {
  timestamp: number
  signatures: Uint8Array[]
} {
  const timestampValues: string[] = []
  const signatures: Uint8Array[] = []
  for (const component of header.split(',')) {
    const [key, value, ...rest] = component.trim().split('=')
    if (rest.length > 0 || !value) continue
    if (key === 't') timestampValues.push(value)
    if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value)) signatures.push(hexBytes(value))
  }
  if (timestampValues.length !== 1 || signatures.length === 0) {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS signature')
  }
  const timestamp = Number(timestampValues[0])
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new ApiError('BAD_REQUEST', 'invalid WorkOS signature')
  }
  return { timestamp, signatures }
}

function hexBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

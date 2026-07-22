import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { createWorkosTeamClient, type WorkosTeamEnv } from './workos-client'
import { revokeLocalWorkosMembership } from './workos-webhook'

export type WorkosCleanupOperation =
  | 'membership.delete'
  | 'organization.delete'
  | 'invitation.revoke'

type WorkosCleanupRow = {
  id: string
  operation: WorkosCleanupOperation
  resource_id: string
  attempts: number
}

const OUTBOX_BATCH_SIZE = 25
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000

export type WorkosCleanupResult = {
  attempted: number
  completed: number
  failed: number
}

export async function enqueueWorkosCleanup(
  db: D1Database,
  args: {
    operation: WorkosCleanupOperation
    resourceId: string
    teamId?: string | null
    userId?: string | null
    now?: number
  },
): Promise<void> {
  const now = args.now ?? Date.now()
  await db
    .prepare(
      `/* workos-cleanup:enqueue */
       INSERT INTO workos_cleanup_outbox
         (id, operation, resource_id, team_id, user_id, attempts,
          next_attempt_at, last_error, created_at, updated_at)
       VALUES (?,?,?,?,?,0,?,NULL,?,?)
       ON CONFLICT(operation,resource_id) DO UPDATE SET
         next_attempt_at=MIN(workos_cleanup_outbox.next_attempt_at, excluded.next_attempt_at),
         team_id=COALESCE(workos_cleanup_outbox.team_id, excluded.team_id),
         user_id=COALESCE(workos_cleanup_outbox.user_id, excluded.user_id),
         updated_at=excluded.updated_at`,
    )
    .bind(
      `woc_${crypto.randomUUID().replace(/-/g, '')}`,
      args.operation,
      args.resourceId,
      args.teamId ?? null,
      args.userId ?? null,
      now,
      now,
      now,
    )
    .run()
}

export async function completeWorkosCleanup(
  db: D1Database,
  operation: WorkosCleanupOperation,
  resourceId: string,
): Promise<void> {
  await db
    .prepare(
      '/* workos-cleanup:complete */ DELETE FROM workos_cleanup_outbox WHERE operation=? AND resource_id=?',
    )
    .bind(operation, resourceId)
    .run()
}

export async function drainWorkosCleanupOutbox(
  db: D1Database,
  env: WorkosTeamEnv,
  now = Date.now(),
): Promise<WorkosCleanupResult> {
  const due = await db
    .prepare(
      `/* workos-cleanup:due */
       SELECT id, operation, resource_id, attempts
       FROM workos_cleanup_outbox
       WHERE next_attempt_at<=?
       ORDER BY next_attempt_at ASC, created_at ASC
       LIMIT ?`,
    )
    .bind(now, OUTBOX_BATCH_SIZE)
    .all<WorkosCleanupRow>()
  if (due.results.length === 0) return { attempted: 0, completed: 0, failed: 0 }

  const client = createWorkosTeamClient(env)
  const result: WorkosCleanupResult = { attempted: 0, completed: 0, failed: 0 }
  for (const row of due.results) {
    result.attempted++
    try {
      if (row.operation === 'membership.delete') {
        await client.deleteMembership(row.resource_id)
      } else if (row.operation === 'organization.delete') {
        await client.deleteOrganization(row.resource_id)
      } else {
        await compensateInvitation(db, client, row.resource_id, now)
      }
      await db.prepare('DELETE FROM workos_cleanup_outbox WHERE id=?').bind(row.id).run()
      result.completed++
    } catch (error) {
      const attempts = row.attempts + 1
      const backoff = Math.min(MAX_BACKOFF_MS, 2 ** Math.min(attempts, 16) * 1_000)
      const detail = error instanceof Error ? error.message : String(error)
      await db
        .prepare(
          `/* workos-cleanup:retry */
           UPDATE workos_cleanup_outbox
           SET attempts=?, next_attempt_at=?, last_error=?, updated_at=?
           WHERE id=?`,
        )
        .bind(attempts, now + backoff, detail.slice(0, 500), now, row.id)
        .run()
      result.failed++
    }
  }
  return result
}

async function compensateInvitation(
  db: D1Database,
  client: ReturnType<typeof createWorkosTeamClient>,
  invitationId: string,
  now: number,
): Promise<void> {
  let invitation
  try {
    invitation = await client.getInvitation(invitationId)
  } catch (error) {
    if (error instanceof ApiError && error.code === 'NOT_FOUND') return
    throw error
  }

  if (invitation.state === 'pending') {
    invitation = await client.revokeInvitation(invitationId)
  }
  if (invitation.state !== 'accepted') return
  if (!invitation.accepted_user_id || !invitation.organization_id) {
    throw new ApiError('INTERNAL', 'accepted WorkOS invitation is missing membership identity')
  }

  // Revoking an accepted invitation does not revoke the Organization grant it
  // already created. Resolve the exact active membership, delete it upstream,
  // then close the matching D1 authorization path immediately instead of
  // waiting for a webhook retry.
  const active = (await client.listActiveMemberships(invitation.accepted_user_id)).find(
    (membership) => membership.organization_id === invitation.organization_id,
  )
  const local = active
    ? null
    : await db
        .prepare(
          `/* workos-cleanup:accepted-invitation-local-membership */
           SELECT membership.workos_membership_id
           FROM team_memberships membership
           JOIN teams team ON team.id=membership.team_id
           JOIN user_identities identity ON identity.user_id=membership.user_id
           WHERE team.workos_organization_id=?
             AND identity.provider='workos' AND identity.provider_sub=?
             AND membership.workos_membership_id IS NOT NULL
           LIMIT 1`,
        )
        .bind(invitation.organization_id, invitation.accepted_user_id)
        .first<{ workos_membership_id: string }>()
  const membershipId = active?.id ?? local?.workos_membership_id ?? null
  if (!membershipId) return
  if (active) await client.deleteMembership(membershipId)
  await revokeLocalWorkosMembership(db, {
    membershipId,
    workosUserId: invitation.accepted_user_id,
    organizationId: invitation.organization_id,
    workosUpdatedAt: active?.updated_at ? Date.parse(active.updated_at) : null,
    eventType: 'invitation.compensation',
    now,
  })
}

export async function opportunisticallyDrainWorkosCleanup(
  db: D1Database,
  env: WorkosTeamEnv,
): Promise<void> {
  try {
    await drainWorkosCleanupOutbox(db, env)
  } catch (error) {
    // The outbox is the durability boundary. Request success must not depend
    // on an opportunistic drain; the internal cron trigger will retry it.
    console.error(
      JSON.stringify({
        message: 'opportunistic WorkOS cleanup drain failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }
}

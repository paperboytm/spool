import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import {
  getTeamMembership,
  getTeamByWorkosOrganizationId,
  reconcileInvitationProjections,
  syncLocalMembership,
} from './store'
import { createWorkosTeamClient, type WorkosTeamEnv } from './workos-client'
import { revokeLocalWorkosMembership } from './workos-webhook'

type LocalWorkosMembership = {
  workos_membership_id: string
  workos_organization_id: string
}

const LOCAL_MEMBERSHIP_PAGE_SIZE = 500

export async function syncWorkosMemberships(
  db: D1Database,
  env: WorkosTeamEnv,
  args: { localUserId: string; workosUserId: string; email: string },
): Promise<void> {
  const client = createWorkosTeamClient(env)
  // Capture only pre-existing rows. If a separate request creates or replaces
  // a membership while the WorkOS pages are loading, the final exact-id
  // predicate prevents this reconciliation from revoking that newer grant.
  const localBeforeSync = await listAllLocalWorkosMemberships(db, args.localUserId)

  // listActiveMemberships throws unless every cursor page completes, so the
  // absent-set reconciliation below can never run from a partial snapshot.
  const memberships = await client.listActiveMemberships(args.workosUserId)
  const now = Date.now()
  for (const membership of memberships) {
    const team = await getTeamByWorkosOrganizationId(db, membership.organization_id)
    if (!team) continue
    const existing = await getTeamMembership(db, team.id, args.localUserId)
    if (!existing) {
      // WorkOS permits some enterprise-domain invitations to be accepted by a
      // different address in the same verified domain. Only a missing local
      // membership needs invitation history; existing roles remain D1-local.
      const invitations = await client.listAllInvitations(team.workos_organization_id)
      await reconcileInvitationProjections(db, team.id, invitations)
    }
    await syncLocalMembership(db, {
      userId: args.localUserId,
      email: args.email.trim().toLowerCase(),
      team,
      membership,
      now,
      skipInvitationLookup: existing !== null,
    })
  }

  const activeIds = new Set(memberships.map((membership) => membership.id))
  for (const local of localBeforeSync) {
    if (activeIds.has(local.workos_membership_id)) continue
    let exact
    try {
      exact = await client.getMembership(local.workos_membership_id)
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'NOT_FOUND') throw error
    }
    if (exact) {
      if (
        exact.id !== local.workos_membership_id ||
        exact.user_id !== args.workosUserId ||
        exact.organization_id !== local.workos_organization_id
      ) {
        throw new ApiError('INTERNAL', 'WorkOS membership identity changed during reconciliation')
      }
      if (exact.status === 'active') continue
      await revokeLocalWorkosMembership(db, {
        eventType: 'organization_membership.updated',
        membershipId: exact.id,
        workosUserId: exact.user_id,
        organizationId: exact.organization_id,
        workosUpdatedAt: exact.updated_at ? Date.parse(exact.updated_at) : now,
        now,
      })
      continue
    }
    await revokeLocalWorkosMembership(db, {
      eventType: 'organization_membership.deleted',
      membershipId: local.workos_membership_id,
      workosUserId: args.workosUserId,
      organizationId: local.workos_organization_id,
      workosUpdatedAt: null,
      now,
    })
  }
}

async function listAllLocalWorkosMemberships(
  db: D1Database,
  userId: string,
): Promise<LocalWorkosMembership[]> {
  const memberships: LocalWorkosMembership[] = []
  let after = ''
  while (true) {
    const page = await db
      .prepare(
        `/* teams:local-workos-memberships */
         SELECT m.workos_membership_id, t.workos_organization_id
         FROM team_memberships m JOIN teams t ON t.id=m.team_id
         WHERE m.user_id=? AND m.workos_membership_id IS NOT NULL
           AND t.archived_at IS NULL AND m.workos_membership_id>?
         ORDER BY m.workos_membership_id ASC
         LIMIT ?`,
      )
      .bind(userId, after, LOCAL_MEMBERSHIP_PAGE_SIZE)
      .all<LocalWorkosMembership>()
    memberships.push(...page.results)
    if (page.results.length < LOCAL_MEMBERSHIP_PAGE_SIZE) return memberships
    const next = page.results.at(-1)?.workos_membership_id
    if (!next || next <= after)
      throw new ApiError('INTERNAL', 'invalid local membership pagination')
    after = next
  }
}

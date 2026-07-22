import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { getTeamById, getTeamMembership } from './store'
import {
  hasTeamPermission,
  type TeamMembershipRow,
  type TeamPermission,
  type TeamRow,
} from './types'

export type TeamAccess = { team: TeamRow; membership: TeamMembershipRow }

export async function requireTeamAccess(
  db: D1Database,
  teamId: string,
  userId: string,
  permission?: TeamPermission,
): Promise<TeamAccess> {
  const [team, membership] = await Promise.all([
    getTeamById(db, teamId),
    getTeamMembership(db, teamId, userId),
  ])
  // Collapse missing Team and non-membership to one 404. Team ids are opaque,
  // but authorization should not become an enumeration oracle.
  if (!team || !membership) throw new ApiError('NOT_FOUND')
  if (team.deletion_pending_until !== null) {
    throw new ApiError('CONFLICT', 'team deletion pending')
  }
  if (permission && !hasTeamPermission(membership.role, permission)) {
    throw new ApiError('FORBIDDEN')
  }
  return { team, membership }
}

export function assertCanManageMember(
  actor: TeamMembershipRow,
  target: TeamMembershipRow,
  nextRole?: TeamMembershipRow['role'],
): void {
  if (actor.user_id === target.user_id) {
    throw new ApiError('CONFLICT', 'use the leave endpoint for your own membership')
  }
  if (actor.role === 'admin' && (target.role !== 'member' || nextRole === 'owner')) {
    throw new ApiError('FORBIDDEN')
  }
}

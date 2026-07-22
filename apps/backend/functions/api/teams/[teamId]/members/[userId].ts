import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../src/audit-after-commit'
import { requireUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { getUserById } from '../../../../../src/store/d1'
import { assertCanManageMember, requireTeamAccess } from '../../../../../src/teams/auth'
import {
  completeWorkosCleanup,
  opportunisticallyDrainWorkosCleanup,
} from '../../../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../../../src/teams/env'
import {
  countTeamOwners,
  getTeamMembership,
  listTeamMembers,
  removeLocalMembership,
  transferTeamOwnership,
  updateMemberRole,
} from '../../../../../src/teams/store'
import {
  parseUpdateMemberBody,
  requireTeamId,
  requireUserId,
} from '../../../../../src/teams/validators'
import { createWorkosTeamClient } from '../../../../../src/teams/workos-client'

type Params = 'teamId' | 'userId'

export const onRequestPatch: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const targetUserId = requireUserId(ctx.params.userId)
    const { role } = await parseUpdateMemberBody(ctx.request)
    const { membership: actor } = await requireTeamAccess(
      ctx.env.DB,
      teamId,
      user.id,
      'members:manage',
    )
    const target = await getTeamMembership(ctx.env.DB, teamId, targetUserId)
    if (!target) throw new ApiError('NOT_FOUND')
    assertCanManageMember(actor, target, role)
    if (role === 'owner') {
      if (actor.role !== 'owner') throw new ApiError('FORBIDDEN')
      const targetUser = await getUserById(ctx.env.DB, targetUserId)
      if (!targetUser || targetUser.deletion_pending_until !== null) {
        throw new ApiError('CONFLICT', 'cannot transfer ownership to a deleting account')
      }
    }
    if (
      target.role === 'owner' &&
      role !== 'owner' &&
      (await countTeamOwners(ctx.env.DB, teamId)) <= 1
    ) {
      throw new ApiError('CONFLICT', 'a team must keep at least one owner')
    }
    const now = Date.now()
    const changed =
      role === 'owner'
        ? await transferTeamOwnership(ctx.env.DB, teamId, actor.user_id, targetUserId, now)
        : await updateMemberRole(ctx.env.DB, teamId, targetUserId, actor.user_id, role, now)
    if (!changed) throw new ApiError('CONFLICT', 'membership changed; reload and try again')
    const currentActor = await getTeamMembership(ctx.env.DB, teamId, actor.user_id)
    if (!currentActor) throw new ApiError('NOT_FOUND')
    const member = (await listTeamMembers(ctx.env.DB, teamId, currentActor)).find(
      (candidate) => candidate.user_id === targetUserId,
    )
    if (!member) throw new ApiError('NOT_FOUND')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.member.role.update',
      target_id: teamId,
      details: { member_user_id: targetUserId, role },
    })
    return jsonOk({ member })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestDelete: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const targetUserId = requireUserId(ctx.params.userId)
    const { membership: actor } = await requireTeamAccess(
      ctx.env.DB,
      teamId,
      user.id,
      'members:manage',
    )
    const target = await getTeamMembership(ctx.env.DB, teamId, targetUserId)
    if (!target) throw new ApiError('NOT_FOUND')
    assertCanManageMember(actor, target)
    if (target.role === 'owner' && (await countTeamOwners(ctx.env.DB, teamId)) <= 1) {
      throw new ApiError('CONFLICT', 'a team must keep at least one owner')
    }

    // D1 is the authorization truth. Remove + block atomically before
    // attempting WorkOS cleanup, so an upstream delay cannot prolong access.
    const removed = await removeLocalMembership(
      ctx.env.DB,
      teamId,
      targetUserId,
      user.id,
      target.workos_membership_id,
      Date.now(),
    )
    if (!removed) throw new ApiError('CONFLICT', 'a team must keep at least one owner')
    if (target.workos_membership_id) {
      await createWorkosTeamClient(ctx.env)
        .deleteMembership(target.workos_membership_id)
        .then(() =>
          completeWorkosCleanup(ctx.env.DB, 'membership.delete', target.workos_membership_id!),
        )
        .catch((error: unknown) => {
          console.error('failed to delete WorkOS organization membership', error)
        })
    }
    ctx.waitUntil(opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env))
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.member.remove',
      target_id: teamId,
      details: { member_user_id: targetUserId },
    })
    return jsonOk({})
  } catch (error) {
    return jsonError(error)
  }
}

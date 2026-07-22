import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { requireTeamAccess } from '../../../../src/teams/auth'
import {
  completeWorkosCleanup,
  opportunisticallyDrainWorkosCleanup,
} from '../../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../../src/teams/env'
import { countTeamOwners, removeLocalMembership } from '../../../../src/teams/store'
import { requireTeamId } from '../../../../src/teams/validators'
import { createWorkosTeamClient } from '../../../../src/teams/workos-client'

type Params = 'teamId'

export const onRequestPost: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const { membership } = await requireTeamAccess(ctx.env.DB, teamId, user.id, 'team:leave')
    if (membership.role === 'owner' && (await countTeamOwners(ctx.env.DB, teamId)) <= 1) {
      throw new ApiError('CONFLICT', 'transfer ownership before leaving this team')
    }
    const removed = await removeLocalMembership(
      ctx.env.DB,
      teamId,
      user.id,
      user.id,
      membership.workos_membership_id,
      Date.now(),
    )
    if (!removed) throw new ApiError('CONFLICT', 'transfer ownership before leaving this team')
    if (membership.workos_membership_id) {
      await createWorkosTeamClient(ctx.env)
        .deleteMembership(membership.workos_membership_id)
        .then(() =>
          completeWorkosCleanup(ctx.env.DB, 'membership.delete', membership.workos_membership_id!),
        )
        .catch((error: unknown) => {
          console.error('failed to delete WorkOS organization membership', error)
        })
    }
    ctx.waitUntil(opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env))
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.leave',
      target_id: teamId,
    })
    return jsonOk({})
  } catch (error) {
    return jsonError(error)
  }
}

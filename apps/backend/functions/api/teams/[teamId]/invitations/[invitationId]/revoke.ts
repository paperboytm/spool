import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../../src/audit-after-commit'
import { requireUser } from '../../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireTeamAccess } from '../../../../../../src/teams/auth'
import type { TeamApiEnv } from '../../../../../../src/teams/env'
import {
  getTeamInvitation,
  listTeamInvitations,
  updateInvitationProjection,
} from '../../../../../../src/teams/store'
import { requireInvitationId, requireTeamId } from '../../../../../../src/teams/validators'
import { createWorkosTeamClient } from '../../../../../../src/teams/workos-client'

type Params = 'teamId' | 'invitationId'

export const onRequestPost: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const invitationId = requireInvitationId(ctx.params.invitationId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id, 'members:invite')
    const current = await getTeamInvitation(ctx.env.DB, teamId, invitationId)
    if (!current) throw new ApiError('NOT_FOUND')
    const upstream = await createWorkosTeamClient(ctx.env).revokeInvitation(
      current.workos_invitation_id,
    )
    await updateInvitationProjection(ctx.env.DB, teamId, upstream)
    const invitation = (await listTeamInvitations(ctx.env.DB, teamId)).find(
      (candidate) => candidate.id === invitationId,
    )
    if (!invitation) throw new ApiError('NOT_FOUND')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.invitation.revoke',
      target_id: teamId,
      details: { invitation_id: invitationId },
    })
    return jsonOk({ invitation })
  } catch (error) {
    return jsonError(error)
  }
}

import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { changeTeamHandle } from '../../../../src/handles'
import { checkRate } from '../../../../src/rate-limit'
import { requireTeamAccess } from '../../../../src/teams/auth'
import {
  completeWorkosCleanup,
  opportunisticallyDrainWorkosCleanup,
} from '../../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../../src/teams/env'
import { TEAM_NAME_UPDATE_RATE } from '../../../../src/teams/limits'
import {
  archiveLocalTeam,
  getTeamForMember,
  updateLocalTeamName,
} from '../../../../src/teams/store'
import { parseUpdateTeamBody, requireTeamId } from '../../../../src/teams/validators'
import { createWorkosTeamClient } from '../../../../src/teams/workos-client'

type Params = 'teamId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id)
    const team = await getTeamForMember(ctx.env.DB, teamId, user.id)
    if (!team) throw new ApiError('NOT_FOUND')
    return jsonOk({ team })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestPatch: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const update = await parseUpdateTeamBody(ctx.request)
    const permission = update.handle === undefined ? 'team:update' : 'team:identity'
    const { team: current } = await requireTeamAccess(ctx.env.DB, teamId, user.id, permission)
    const rate = await checkRate(ctx.env.RATE, {
      ...TEAM_NAME_UPDATE_RATE,
      key: teamId,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    if (update.name !== undefined) {
      const client = createWorkosTeamClient(ctx.env)
      await client.updateOrganization(current.workos_organization_id, update.name)
      try {
        const updated = await updateLocalTeamName(
          ctx.env.DB,
          teamId,
          user.id,
          update.name,
          Date.now(),
        )
        if (!updated) throw new ApiError('FORBIDDEN')
      } catch (error) {
        await client
          .updateOrganization(current.workos_organization_id, current.name)
          .catch((compensationError: unknown) => {
            console.error('failed to compensate WorkOS organization rename', compensationError)
          })
        throw error
      }
    } else if (update.handle !== undefined) {
      await changeTeamHandle(ctx.env.DB, {
        teamId,
        actorUserId: user.id,
        handle: update.handle,
        now: Date.now(),
      })
    }
    const team = await getTeamForMember(ctx.env.DB, teamId, user.id)
    if (!team) throw new ApiError('NOT_FOUND')
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.update',
      target_id: teamId,
      details: { fields: [update.name === undefined ? 'handle' : 'name'] },
    })
    return jsonOk({ team })
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestDelete: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const { team } = await requireTeamAccess(ctx.env.DB, teamId, user.id, 'team:archive')
    const archived = await archiveLocalTeam(ctx.env.DB, teamId, user.id, Date.now())
    if (!archived) throw new ApiError('FORBIDDEN')
    await createWorkosTeamClient(ctx.env)
      .deleteOrganization(team.workos_organization_id)
      .then(() =>
        completeWorkosCleanup(ctx.env.DB, 'organization.delete', team.workos_organization_id),
      )
      .catch((error: unknown) => {
        // D1 has already atomically closed every disclosure path. WorkOS is
        // transport-only here; a transient cleanup failure must not turn a
        // completed privacy action into a misleading failed response.
        console.error('failed to delete archived WorkOS organization', error)
      })
    ctx.waitUntil(opportunisticallyDrainWorkosCleanup(ctx.env.DB, ctx.env))
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'team.archive',
      target_id: teamId,
    })
    return jsonOk({})
  } catch (error) {
    return jsonError(error)
  }
}

import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { requireHubUser } from '../../../../src/hub/auth'
import { activeTeamRole, type HubEnv } from '../../../../src/hub/head'
import { listTeamHubSessions } from '../../../../src/hub/management'

export const onRequestGet: PagesFunction<HubEnv, 'teamId'> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const teamId = typeof ctx.params.teamId === 'string' ? ctx.params.teamId : ''
    const role = teamId ? await activeTeamRole(ctx.env.DB, teamId, user.id) : null
    if (role === null) throw new ApiError('NOT_FOUND')
    return jsonOk({
      sessions: await listTeamHubSessions(ctx.env.DB, teamId, role === 'owner' || role === 'admin'),
    })
  } catch (error) {
    return jsonError(error)
  }
}

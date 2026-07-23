import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { requireHubUser } from '../../../../src/hub/auth'
import type { HubEnv } from '../../../../src/hub/head'
import {
  listTeamHubSessions,
  parseManagedHubSessionPageOptions,
} from '../../../../src/hub/management'

export const onRequestGet: PagesFunction<HubEnv, 'teamId'> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const teamId = typeof ctx.params.teamId === 'string' ? ctx.params.teamId : ''
    const page = teamId
      ? await listTeamHubSessions(
          ctx.env.DB,
          teamId,
          user.id,
          parseManagedHubSessionPageOptions(ctx.request),
        )
      : null
    if (page === null) throw new ApiError('NOT_FOUND')
    return jsonOk(page)
  } catch (error) {
    return jsonError(error)
  }
}

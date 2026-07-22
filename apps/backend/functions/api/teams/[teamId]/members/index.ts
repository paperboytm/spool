import type { PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../../../src/auth/require'
import { jsonError, jsonOk } from '../../../../../src/errors'
import { requireTeamAccess } from '../../../../../src/teams/auth'
import type { TeamApiEnv } from '../../../../../src/teams/env'
import { listTeamMembers } from '../../../../../src/teams/store'
import { requireTeamId } from '../../../../../src/teams/validators'

type Params = 'teamId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    const { membership } = await requireTeamAccess(ctx.env.DB, teamId, user.id)
    return jsonOk({ members: await listTeamMembers(ctx.env.DB, teamId, membership) })
  } catch (error) {
    return jsonError(error)
  }
}

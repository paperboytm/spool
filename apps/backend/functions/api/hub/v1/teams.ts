import type { PagesFunction } from '@cloudflare/workers-types'

import { jsonError, jsonOk } from '../../../../src/errors'
import { requireHubUser } from '../../../../src/hub/auth'
import type { HubEnv } from '../../../../src/hub/head'
import { listTeamsForUser } from '../../../../src/teams/store'

// Team list for CLI callers. `GET /api/teams` deliberately accepts only web
// sessions; this hub twin accepts the long-lived CLI token so `spool
// subscribe` can offer a Team target without a browser round-trip.
export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    return jsonOk({ teams: await listTeamsForUser(ctx.env.DB, user.id) })
  } catch (error) {
    return jsonError(error)
  }
}

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { recordQualifiedRead } from '../../../../../../src/discovery/engagement'
import { jsonError, jsonOk } from '../../../../../../src/errors'
import { requireSid } from '../../../../../../src/hub/wire'

type DiscoveryEngagementEnv = {
  DB: D1Database
  RATE: KVNamespace
}

export const onRequestPost: PagesFunction<DiscoveryEngagementEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const response = await recordQualifiedRead(ctx.env.DB, ctx.env.RATE, ctx.request, sid)
    return jsonOk(response)
  } catch (error) {
    return jsonError(error)
  }
}

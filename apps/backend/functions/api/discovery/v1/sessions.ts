import type { D1Database, PagesFunction } from '@cloudflare/workers-types'

import { DISCOVERY_CACHE_CONTROL, listDiscoverySessions } from '../../../../src/discovery/sessions'
import { jsonError, jsonOk } from '../../../../src/errors'

type DiscoveryListEnv = {
  DB: D1Database
}

export const onRequestGet: PagesFunction<DiscoveryListEnv> = async (ctx) => {
  try {
    const response = await listDiscoverySessions(ctx.env.DB, ctx.request)
    return jsonOk(response, { headers: { 'cache-control': DISCOVERY_CACHE_CONTROL } })
  } catch (error) {
    return jsonError(error)
  }
}

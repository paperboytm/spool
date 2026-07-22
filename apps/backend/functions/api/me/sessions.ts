import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'
import { listOwnerHubSessions } from '../../../src/hub/management'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    return jsonOk({ sessions: await listOwnerHubSessions(ctx.env.DB, user.id) })
  } catch (error) {
    return jsonError(error)
  }
}

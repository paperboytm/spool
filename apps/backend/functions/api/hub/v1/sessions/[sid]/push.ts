import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import { validateHead, type HubEnv } from '../../../../../../src/hub/head'
import { parseHeadBody, requireSid } from '../../../../../../src/hub/wire'
import { checkRate } from '../../../../../../src/rate-limit'

// Step 1 of the share handshake: declare the head, learn what to upload.
// Idempotent and side-effect free — state changes happen in objects/batch
// (step 2) and head (step 3).

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'hub-push-h',
      key: user.id,
      windowSec: 3600,
      max: 360,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const sid = requireSid(ctx.params['sid'])
    const body = await parseHeadBody(ctx.request)
    const { missing } = await validateHead(ctx.env.DB, user.id, sid, body)
    return jsonOk({ missing })
  } catch (e) {
    return jsonError(e)
  }
}

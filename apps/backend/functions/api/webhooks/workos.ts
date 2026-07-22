import type { PagesFunction } from '@cloudflare/workers-types'

import { jsonError, jsonOk } from '../../../src/errors'
import type { TeamApiEnv } from '../../../src/teams/env'
import { processWorkosWebhookEvent, verifyWorkosWebhook } from '../../../src/teams/workos-webhook'

type Env = TeamApiEnv & { WORKOS_WEBHOOK_SECRET?: string }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const event = await verifyWorkosWebhook(ctx.request, ctx.env.WORKOS_WEBHOOK_SECRET)
    // Keep the durability boundary ahead of the 200 response: supported events
    // perform one receipt write plus one fixed-size, set-based D1 batch and no
    // network I/O. This remains fast while ensuring a Worker termination after
    // the response cannot drop a deprovisioning event.
    await processWorkosWebhookEvent(ctx.env.DB, event)
    return jsonOk({ ok: true })
  } catch (error) {
    return jsonError(error)
  }
}

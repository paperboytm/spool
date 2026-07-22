import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { checkRate } from '../../../../src/rate-limit'
import { drainWorkosCleanupOutbox } from '../../../../src/teams/cleanup'
import type { TeamApiEnv } from '../../../../src/teams/env'
import { requireInternalBearer } from '../../../../src/teams/internal-auth'

export const onRequestPost: PagesFunction<TeamApiEnv> = async (ctx) => {
  try {
    await requireInternalBearer(ctx.request, ctx.env.WORKOS_OPERATIONS_TOKEN)
    await requireEmptyBody(ctx.request)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'workos-cleanup-internal',
      key: 'singleton',
      windowSec: 60,
      max: 30,
    })
    if (!rate.ok) return new Response(null, { status: 429 })
    return jsonOk(await drainWorkosCleanupOutbox(ctx.env.DB, ctx.env))
  } catch (error) {
    return jsonError(error)
  }
}

async function requireEmptyBody(request: Request): Promise<void> {
  const contentLength = request.headers.get('content-length')
  if (contentLength !== null && contentLength !== '0') {
    throw new ApiError('BAD_REQUEST', 'empty body required')
  }
  if (!request.body) return
  const reader = request.body.getReader()
  const first = await reader.read()
  await reader.cancel()
  if (!first.done) {
    throw new ApiError('BAD_REQUEST', 'empty body required')
  }
}

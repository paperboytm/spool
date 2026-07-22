import type { PagesFunction } from '@cloudflare/workers-types'

import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { checkRate } from '../../../../src/rate-limit'
import type { TeamApiEnv } from '../../../../src/teams/env'
import { requireInternalBearer } from '../../../../src/teams/internal-auth'
import { createWorkosTeamClient } from '../../../../src/teams/workos-client'

const EVENTS = [
  'organization_membership.deleted',
  'organization_membership.updated',
  'organization.deleted',
  'user.deleted',
] as const

export const onRequestPost: PagesFunction<TeamApiEnv> = async (ctx) => {
  try {
    await requireInternalBearer(ctx.request, ctx.env.WORKOS_BOOTSTRAP_TOKEN)
    await requireEmptyBody(ctx.request)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'workos-webhook-bootstrap',
      key: 'singleton',
      windowSec: 60 * 60,
      max: 3,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const client = createWorkosTeamClient(ctx.env)
    const endpointUrl = workosWebhookUrl(ctx.env.PUBLIC_BASE_URL)
    const existing = (await client.listWebhookEndpoints()).find(
      (candidate) => candidate.endpoint_url === endpointUrl,
    )
    const endpoint = existing
      ? await client.updateWebhookEndpoint(existing.id, endpointUrl, EVENTS)
      : await client.createWebhookEndpoint(endpointUrl, EVENTS)

    // This response is deliberately the only place the webhook secret leaves
    // WorkOS. The caller pipes it into the Pages secret and then removes the
    // short-lived WORKOS_BOOTSTRAP_TOKEN. Never log the response body.
    return jsonOk(
      { id: endpoint.id, secret: endpoint.secret },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}

function workosWebhookUrl(publicBaseUrl: string | undefined): string {
  if (!publicBaseUrl) throw new ApiError('INTERNAL', 'PUBLIC_BASE_URL is required')
  let url: URL
  try {
    url = new URL(publicBaseUrl)
  } catch {
    throw new ApiError('INTERNAL', 'invalid PUBLIC_BASE_URL')
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new ApiError('INTERNAL', 'PUBLIC_BASE_URL must be a credential-free HTTPS origin')
  }
  return `${url.origin}/api/webhooks/workos`
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

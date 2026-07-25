import type { PagesFunction } from '@cloudflare/workers-types'

import { base64urlFromBuffer, sha256 } from '../../../../../../src/auth/pkce'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import { requireReadableSession, type HubEnv } from '../../../../../../src/hub/head'
import { issueResumeGrant, parseResumeGrantPosition } from '../../../../../../src/hub/resume-grants'
import { requireSid } from '../../../../../../src/hub/wire'
import { checkRate } from '../../../../../../src/rate-limit'
import { clientIp } from '../../../../../../src/request'

const CLIENT_RATE = { bucket: 'hub-resume-grant-client-h', windowSec: 3600, max: 60 }
const TARGET_RATE = { bucket: 'hub-resume-grant-target-h', windowSec: 3600, max: 20 }
const RESPONSE_HEADERS = {
  'cache-control': 'private, no-store',
  vary: 'Cookie, Authorization',
}

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const position = await parseResumeGrantPosition(ctx.request)
    const requester = base64urlFromBuffer(
      await sha256(
        `${clientIp(ctx.request)}\n${ctx.request.headers.get('user-agent') ?? '-'}\nresume-grant`,
      ),
    )
    const clientRate = await checkRate(ctx.env.RATE, { ...CLIENT_RATE, key: requester })
    if (!clientRate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const session = await requireReadableSession(ctx.request, ctx.env, sid)
    if (position > session.record_count) {
      throw new ApiError('BAD_REQUEST', 'position exceeds the Session record count')
    }
    const teamViewer =
      session.visibility === 'private' ? await requireHubUser(ctx.request, ctx.env) : null
    const targetRate = await checkRate(ctx.env.RATE, {
      ...TARGET_RATE,
      key: `${requester}:${sid}`,
    })
    if (!targetRate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    return jsonOk(await issueResumeGrant(ctx.env.DB, session, position, teamViewer?.id ?? null), {
      headers: RESPONSE_HEADERS,
    })
  } catch (error) {
    const response = jsonError(error)
    const headers = new Headers(response.headers)
    for (const [name, value] of Object.entries(RESPONSE_HEADERS)) headers.set(name, value)
    return new Response(response.body, { status: response.status, headers })
  }
}

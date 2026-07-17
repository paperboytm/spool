// Unauthenticated: `spool login` calls this before the user has any
// credential. Returns the device_code (secret, for polling), the
// user_code (human-readable, shown in both terminal and browser), and
// the verification URL the CLI opens.

import type { KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import {
  CLI_AUTH_POLL_INTERVAL_SEC,
  CLI_AUTH_TTL_SEC,
  createCliAuthRequest,
} from '../../../src/cli-auth'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { publicBaseUrl } from '../../../src/public-url'
import { checkRate } from '../../../src/rate-limit'
import { clientIp } from '../../../src/request'

type Env = {
  NONCE: KVNamespace
  RATE: KVNamespace
  PUBLIC_BASE_URL?: string
}

// 10 pending requests per IP per hour. A human retrying a botched login
// stays well inside; a scripted flood of KV writes does not.
export const CLI_AUTH_START_RATE_WINDOW_SEC = 3600
export const CLI_AUTH_START_RATE_MAX = 10

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'cli-auth-start',
      key: clientIp(ctx.request),
      windowSec: CLI_AUTH_START_RATE_WINDOW_SEC,
      max: CLI_AUTH_START_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    // Label is advisory (shown on the approval page) — hostname etc.
    let label: string | null = null
    try {
      const body = (await ctx.request.json()) as { label?: unknown }
      if (typeof body.label === 'string' && body.label.trim() !== '') {
        label = body.label.trim().slice(0, 100)
      }
    } catch {
      // Empty body is fine.
    }

    const { deviceCode, userCode } = await createCliAuthRequest(ctx.env.NONCE, label)
    return jsonOk({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: `${publicBaseUrl(ctx.env)}/cli-auth?code=${encodeURIComponent(userCode)}`,
      expires_in: CLI_AUTH_TTL_SEC,
      interval: CLI_AUTH_POLL_INTERVAL_SEC,
    })
  } catch (e) {
    return jsonError(e)
  }
}

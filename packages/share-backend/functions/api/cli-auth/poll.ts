// Polled by `spool login` with the secret device_code. Pending returns
// a retry hint; approval hands the sph_ token out exactly once and
// deletes the record, so a replay (or a second racing poller) gets 404.

import type { KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import {
  CLI_AUTH_POLL_INTERVAL_SEC,
  claimCliAuth,
  getCliAuthByDeviceCode,
} from '../../../src/cli-auth'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'
import { clientIp } from '../../../src/request'

type Env = {
  NONCE: KVNamespace
  RATE: KVNamespace
}

// The CLI polls every CLI_AUTH_POLL_INTERVAL_SEC (3s → 20/min); 60/min
// leaves room for a couple of concurrent logins behind one NAT.
export const CLI_AUTH_POLL_RATE_WINDOW_SEC = 60
export const CLI_AUTH_POLL_RATE_MAX = 60

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'cli-auth-poll',
      key: clientIp(ctx.request),
      windowSec: CLI_AUTH_POLL_RATE_WINDOW_SEC,
      max: CLI_AUTH_POLL_RATE_MAX,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    let body: { device_code?: unknown }
    try {
      body = (await ctx.request.json()) as { device_code?: unknown }
    } catch {
      throw new ApiError('BAD_REQUEST', 'invalid json')
    }
    if (typeof body.device_code !== 'string' || body.device_code === '') {
      throw new ApiError('BAD_REQUEST', 'missing device_code')
    }

    const record = await getCliAuthByDeviceCode(ctx.env.NONCE, body.device_code)
    if (!record) throw new ApiError('NOT_FOUND', 'expired or denied')

    if (record.status === 'pending') {
      return jsonOk({ status: 'pending', interval: CLI_AUTH_POLL_INTERVAL_SEC })
    }

    const token = await claimCliAuth(ctx.env.NONCE, body.device_code, record)
    if (!token) throw new ApiError('NOT_FOUND', 'expired or denied')
    return jsonOk({ status: 'approved', token })
  } catch (e) {
    return jsonError(e)
  }
}

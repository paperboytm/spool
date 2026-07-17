// The browser side of the CLI login flow. Both verbs require a web
// session (requireUser, never an API token — a stolen sph_ token must
// not approve further tokens; same rule as /api/hub/v1/tokens).
//
//   GET  ?code=XXXX-XXXX   → request metadata for the approval page
//   POST {user_code, decision: 'approve' | 'deny'}
//
// CSRF: the session cookie is SameSite=Lax, so a cross-site POST never
// carries it — same posture as every other cookie-authenticated POST
// in this API.

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../src/audit'
import { requireUser } from '../../../src/auth/require'
import {
  type CliAuthRecord,
  approveCliAuth,
  denyCliAuth,
  getCliAuthByUserCode,
  normalizeUserCode,
} from '../../../src/cli-auth'
import { TOKEN_MINT_RATE, mintApiToken } from '../../../src/hub/tokens'
import { ApiError, jsonError, jsonOk } from '../../../src/errors'
import { checkRate } from '../../../src/rate-limit'

type Env = {
  DB: D1Database
  SESSIONS: KVNamespace
  NONCE: KVNamespace
  RATE: KVNamespace
}

// Lookup throttle per user. user_code carries ~38 bits; combined with
// the 15-minute record TTL this makes enumeration from a signed-in
// account a non-starter without ever inconveniencing a human.
export const CLI_AUTH_LOOKUP_RATE_WINDOW_SEC = 60
export const CLI_AUTH_LOOKUP_RATE_MAX = 30

async function lookupThrottled(
  env: Env,
  userId: string,
  rawCode: string | null,
): Promise<{ deviceCode: string; record: CliAuthRecord }> {
  const rate = await checkRate(env.RATE, {
    bucket: 'cli-auth-lookup',
    key: userId,
    windowSec: CLI_AUTH_LOOKUP_RATE_WINDOW_SEC,
    max: CLI_AUTH_LOOKUP_RATE_MAX,
  })
  if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
  const userCode = rawCode ? normalizeUserCode(rawCode) : null
  if (!userCode) throw new ApiError('BAD_REQUEST', 'invalid code')
  const found = await getCliAuthByUserCode(env.NONCE, userCode)
  if (!found || found.record.status !== 'pending') {
    throw new ApiError('NOT_FOUND', 'expired or already handled')
  }
  return found
}

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const url = new URL(ctx.request.url)
    const { record } = await lookupThrottled(ctx.env, user.id, url.searchParams.get('code'))
    return jsonOk({
      user_code: record.user_code,
      label: record.label,
      created: record.created,
    })
  } catch (e) {
    return jsonError(e)
  }
}

type Body = { user_code?: unknown; decision?: unknown }

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)

    let body: Body
    try {
      body = (await ctx.request.json()) as Body
    } catch {
      throw new ApiError('BAD_REQUEST', 'invalid json')
    }
    const decision = body.decision === 'approve' || body.decision === 'deny' ? body.decision : null
    if (typeof body.user_code !== 'string' || !decision) {
      throw new ApiError('BAD_REQUEST', 'missing fields')
    }

    const { deviceCode, record } = await lookupThrottled(ctx.env, user.id, body.user_code)

    if (decision === 'deny') {
      await denyCliAuth(ctx.env.NONCE, deviceCode, record)
      await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
        user_id: user.id,
        action: 'cli-auth.deny',
      })
      return jsonOk({ ok: true })
    }

    const rate = await checkRate(ctx.env.RATE, { ...TOKEN_MINT_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    const { id, token } = await mintApiToken(
      ctx.env.DB,
      user.id,
      record.label ? `cli: ${record.label}` : 'cli',
    )
    await approveCliAuth(ctx.env.NONCE, deviceCode, record, token)
    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'cli-auth.approve',
      target_id: id,
    })
    return jsonOk({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}

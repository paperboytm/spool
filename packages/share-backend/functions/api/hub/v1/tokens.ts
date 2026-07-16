import type { PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../../src/audit'
import { requireUser } from '../../../../src/auth/require'
import { sha256Hex } from '../../../../src/hub/auth'
import type { HubEnv } from '../../../../src/hub/head'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { checkRate } from '../../../../src/rate-limit'

// Mint a long-lived CLI token. Session-auth only (requireUser, not
// requireHubUser): an API token must never be able to mint more tokens.
// The token value is returned exactly once; only its sha256 is stored.

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'hub-token-d',
      key: user.id,
      windowSec: 86400,
      max: 10,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    let label: string | null = null
    try {
      const body = (await ctx.request.json()) as { label?: unknown }
      if (typeof body.label === 'string' && body.label.length <= 100) label = body.label
    } catch {
      // Empty body is fine.
    }

    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const token = 'sph_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    const id = crypto.randomUUID()

    await ctx.env.DB.prepare(
      'INSERT INTO api_tokens (id, user_id, token_hash, label, created_at) VALUES (?,?,?,?,?)',
    )
      .bind(id, user.id, await sha256Hex(token), label, Date.now())
      .run()

    await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
      user_id: user.id,
      action: 'hub-token-create',
      target_id: id,
    })

    return jsonOk({ id, token })
  } catch (e) {
    return jsonError(e)
  }
}

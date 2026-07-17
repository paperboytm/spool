import type { PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../../src/audit'
import { requireUser } from '../../../../src/auth/require'
import type { HubEnv } from '../../../../src/hub/head'
import { TOKEN_MINT_RATE, mintApiToken } from '../../../../src/hub/tokens'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { checkRate } from '../../../../src/rate-limit'

// Mint a long-lived CLI token. Session-auth only (requireUser, not
// requireHubUser): an API token must never be able to mint more tokens.
// The token value is returned exactly once; only its sha256 is stored.

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, { ...TOKEN_MINT_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    let label: string | null = null
    try {
      const body = (await ctx.request.json()) as { label?: unknown }
      if (typeof body.label === 'string' && body.label.length <= 100) label = body.label
    } catch {
      // Empty body is fine.
    }

    const { id, token } = await mintApiToken(ctx.env.DB, user.id, label)

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

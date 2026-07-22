import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { sha256Hex } from '../../../../src/hub/auth'
import type { HubEnv } from '../../../../src/hub/head'
import { TOKEN_MINT_RATE, mintApiToken } from '../../../../src/hub/tokens'
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

    auditAfterCommit(ctx, {
      user_id: user.id,
      action: 'hub-token-create',
      target_id: id,
    })

    return jsonOk({ id, token })
  } catch (e) {
    return jsonError(e)
  }
}

// Revoke the presented token (`spool logout`). Token-auth only — the
// credential to revoke IS the bearer; a web session names no token. An
// unknown or already-revoked token is 401, same as everywhere else.

export const onRequestDelete: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const bearer = ctx.request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!bearer) throw new ApiError('UNAUTHENTICATED', 'API token required')

    // The dev shortcut token lives in the env, not D1 — nothing to revoke.
    if (ctx.env.HUB_DEV_TOKEN && bearer === ctx.env.HUB_DEV_TOKEN) {
      return jsonOk({ revoked: true })
    }

    const hash = await sha256Hex(bearer)
    const row = await ctx.env.DB.prepare('SELECT id, user_id FROM api_tokens WHERE token_hash=?')
      .bind(hash)
      .first<{ id: string; user_id: string }>()
    if (!row) throw new ApiError('UNAUTHENTICATED')

    await ctx.env.DB.prepare('DELETE FROM api_tokens WHERE token_hash=?').bind(hash).run()

    auditAfterCommit(ctx, {
      user_id: row.user_id,
      action: 'hub-token-revoke',
      target_id: row.id,
    })

    return jsonOk({ revoked: true })
  } catch (e) {
    return jsonError(e)
  }
}

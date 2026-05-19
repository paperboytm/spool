import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import { jsonError, jsonOk } from '../../../src/errors'
import { CC_PRIVATE_NO_CACHE } from '../../../src/security/cache-control'

type Env = { DB: D1Database; SESSIONS: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    // /api/me is the bootstrap call for any signed-in client. A user with
    // a pending deletion still needs to see their own state — otherwise
    // they can't open the account UI to find the Cancel button. Other
    // mutating endpoints stay locked behind the default policy.
    const user = await requireUser(ctx.request, ctx.env, { allowPendingDeletion: true })
    const handle = await ctx.env.DB
      .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL')
      .bind(user.id)
      .first<{ handle: string }>()
    return jsonOk(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar_url: user.avatar_url,
        handle: handle?.handle ?? null,
        deletion_pending_until: user.deletion_pending_until,
      },
      { headers: { 'cache-control': CC_PRIVATE_NO_CACHE } },
    )
  } catch (e) {
    return jsonError(e)
  }
}

import type { PagesFunction } from '@cloudflare/workers-types'

import { audit } from '../../../../../../src/audit'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import type { HubEnv } from '../../../../../../src/hub/head'
import { getHubSession, withdrawHubSession } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'

// Tombstone, not deletion: the meta endpoint answers 410 immediately, the
// body endpoints refuse, R2 objects stay put (account deletion is the
// path that physically purges).

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])

    const existing = await getHubSession(ctx.env.DB, sid)
    if (!existing) throw new ApiError('NOT_FOUND')
    if (existing.owner_user_id !== user.id) throw new ApiError('FORBIDDEN', 'not owner')

    if (existing.withdrawn_at === null) {
      const changed = await withdrawHubSession(ctx.env.DB, sid, user.id, Date.now())
      if (!changed) throw new ApiError('INTERNAL', 'withdraw failed')
      await audit(ctx.env.DB, ctx.env.RATE, ctx.request, {
        user_id: user.id,
        action: 'hub-withdraw',
        target_id: sid,
      })
    }

    return jsonOk({ withdrawn: true })
  } catch (e) {
    return jsonError(e)
  }
}

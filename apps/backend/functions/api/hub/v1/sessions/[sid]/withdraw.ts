import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../../src/audit-after-commit'
import { prepareAuthorizedTargetStarsDelete } from '../../../../../../src/discovery/projection'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireHubUser } from '../../../../../../src/hub/auth'
import { activeTeamRole, type HubEnv } from '../../../../../../src/hub/head'
import { getHubSession, prepareAuthorizedWithdrawal } from '../../../../../../src/hub/store'
import { requireSid } from '../../../../../../src/hub/wire'
import { checkRate } from '../../../../../../src/rate-limit'

// Tombstone, not deletion: the meta endpoint answers 410 immediately, the
// body endpoints refuse, R2 objects stay put (account deletion is the
// path that physically purges).

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])

    const existing = await getHubSession(ctx.env.DB, sid)
    if (!existing) throw new ApiError('NOT_FOUND')
    if (existing.team_id) {
      const role = await activeTeamRole(ctx.env.DB, existing.team_id, user.id)
      if (role === null) throw new ApiError('NOT_FOUND')
      if (role !== 'owner' && role !== 'admin') throw new ApiError('FORBIDDEN')
    } else if (existing.owner_user_id !== user.id) {
      throw new ApiError('FORBIDDEN', 'not owner')
    }
    const rate = await checkRate(ctx.env.RATE, {
      bucket: 'hub-withdraw-h',
      key: `${user.id}:${sid}`,
      windowSec: 60 * 60,
      max: 30,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')

    if (existing.withdrawn_at === null) {
      const now = Date.now()
      const results = await ctx.env.DB.batch([
        prepareAuthorizedWithdrawal(ctx.env.DB, {
          sid,
          actorUserId: user.id,
          expectedTeamId: existing.team_id,
          now,
        }),
        prepareAuthorizedTargetStarsDelete(ctx.env.DB, {
          sid,
          actorUserId: user.id,
          teamId: existing.team_id,
          root: existing.root,
          updatedAt: now,
          visibility: existing.visibility === 'private' ? 'private' : 'unlisted',
          withdrawn: true,
          requireAuthor: false,
          requireTeamManager: existing.team_id !== null,
        }),
      ])
      if ((results[0]?.meta.changes ?? 0) === 0) throw new ApiError('NOT_FOUND')
      auditAfterCommit(ctx, {
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

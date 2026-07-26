import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../src/auth/require'
import { ApiError } from '../../../../src/errors'
import { requireOwnerHandle } from '../../../../src/projects/validators'
import { clientIp } from '../../../../src/request'
import {
  parseSocialListOptions,
  requireSocialListRate,
  socialError,
  socialOk,
} from '../../../../src/social/limits'
import { listUserFollowers, resolveUserFollowTarget } from '../../../../src/social/users'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const viewer = await optionalUser(ctx.request, ctx.env)
    await requireSocialListRate(
      ctx.env.RATE,
      viewer ? `user:${viewer.id}` : `ip:${clientIp(ctx.request)}`,
      'user-graph',
    )
    const target = await resolveUserFollowTarget(ctx.env.DB, handle)
    if (!target) throw new ApiError('NOT_FOUND')
    const page = await listUserFollowers(
      ctx.env.DB,
      target,
      await parseSocialListOptions(ctx.request, ['user-followers', target.id]),
    )
    return socialOk({ followers: page.rows, next_cursor: page.nextCursor })
  } catch (error) {
    return socialError(error)
  }
}

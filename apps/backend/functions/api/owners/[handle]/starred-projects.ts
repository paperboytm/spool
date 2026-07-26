import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../src/auth/require'
import { requireOwnerHandle } from '../../../../src/projects/validators'
import { clientIp } from '../../../../src/request'
import {
  parseSocialListOptions,
  requireSocialListRate,
  socialError,
  socialOk,
} from '../../../../src/social/limits'
import {
  listStarredProjectsForOwner,
  type SocialProjectListResponse,
} from '../../../../src/social/projects'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const viewer = await optionalUser(ctx.request, ctx.env)
    await requireSocialListRate(
      ctx.env.RATE,
      viewer ? `user:${viewer.id}` : `ip:${clientIp(ctx.request)}`,
      'owner-starred-projects',
    )
    const page = await listStarredProjectsForOwner(
      ctx.env.DB,
      handle,
      await parseSocialListOptions(ctx.request, ['owner-starred-projects', handle]),
    )
    const response: SocialProjectListResponse = {
      projects: page.rows,
      next_cursor: page.nextCursor,
    }
    return socialOk(response)
  } catch (error) {
    return socialError(error)
  }
}

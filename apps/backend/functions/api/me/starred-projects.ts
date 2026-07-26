import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../src/auth/require'
import {
  parseSocialListOptions,
  requireSocialListRate,
  socialError,
  socialOk,
} from '../../../src/social/limits'
import {
  listStarredProjectsForUser,
  type SocialProjectListResponse,
} from '../../../src/social/projects'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    await requireSocialListRate(ctx.env.RATE, `user:${user.id}`, 'starred-projects')
    const page = await listStarredProjectsForUser(
      ctx.env.DB,
      user.id,
      await parseSocialListOptions(ctx.request, ['me-starred-projects', user.id]),
    )
    const response: SocialProjectListResponse = {
      projects: page.rows,
      next_cursor: page.nextCursor,
    }
    return socialOk(response, { private: true })
  } catch (error) {
    return socialError(error)
  }
}

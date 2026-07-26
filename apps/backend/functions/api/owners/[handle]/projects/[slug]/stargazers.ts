import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../../src/auth/require'
import { ApiError } from '../../../../../../src/errors'
import { requireOwnerHandle, requireProjectSlug } from '../../../../../../src/projects/validators'
import { clientIp } from '../../../../../../src/request'
import {
  parseSocialListOptions,
  requireSocialListRate,
  socialError,
  socialOk,
} from '../../../../../../src/social/limits'
import {
  listProjectStargazers,
  resolveProjectSocialTarget,
} from '../../../../../../src/social/projects'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle' | 'slug'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const slug = requireProjectSlug(ctx.params.slug)
    const viewer = await optionalUser(ctx.request, ctx.env)
    await requireSocialListRate(
      ctx.env.RATE,
      viewer ? `user:${viewer.id}` : `ip:${clientIp(ctx.request)}`,
      'project-stargazers',
    )
    const target = await resolveProjectSocialTarget(ctx.env.DB, handle, slug, viewer?.id ?? null)
    if (!target) throw new ApiError('NOT_FOUND')
    const page = await listProjectStargazers(
      ctx.env.DB,
      target,
      await parseSocialListOptions(ctx.request, ['project-stargazers', target.projectId]),
    )
    return socialOk(
      { stargazers: page.rows, next_cursor: page.nextCursor },
      { private: !target.isPublic },
    )
  } catch (error) {
    return socialError(error)
  }
}

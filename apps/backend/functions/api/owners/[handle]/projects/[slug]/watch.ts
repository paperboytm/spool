import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../../../../src/auth/require'
import { ApiError } from '../../../../../../src/errors'
import { requireOwnerHandle, requireProjectSlug } from '../../../../../../src/projects/validators'
import {
  requireSocialMutationRate,
  socialError,
  socialOk,
} from '../../../../../../src/social/limits'
import {
  getProjectSocialSnapshot,
  resolveProjectSocialTarget,
  unwatchProject,
  watchProject,
} from '../../../../../../src/social/projects'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle' | 'slug'

export const onRequestPut: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const target = await requireTarget(ctx, user.id)
    await requireSocialMutationRate(ctx.env.RATE, user.id, target.projectId, 'project-watch')
    await watchProject(ctx.env.DB, target, user.id)
    const snapshot = await getProjectSocialSnapshot(ctx.env.DB, target, user.id)
    return socialOk(snapshot.state, {
      private: !snapshot.isPublic,
    })
  } catch (error) {
    return socialError(error)
  }
}

export const onRequestDelete: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const target = await requireTarget(ctx, user.id)
    await requireSocialMutationRate(ctx.env.RATE, user.id, target.projectId, 'project-watch')
    await unwatchProject(ctx.env.DB, target, user.id)
    const snapshot = await getProjectSocialSnapshot(ctx.env.DB, target, user.id)
    return socialOk(snapshot.state, {
      private: !snapshot.isPublic,
    })
  } catch (error) {
    return socialError(error)
  }
}

async function requireTarget(ctx: Parameters<typeof onRequestPut>[0], userId: string) {
  const target = await resolveProjectSocialTarget(
    ctx.env.DB,
    requireOwnerHandle(ctx.params.handle),
    requireProjectSlug(ctx.params.slug),
    userId,
  )
  if (!target) throw new ApiError('NOT_FOUND')
  return target
}

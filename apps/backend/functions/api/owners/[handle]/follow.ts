import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser, requireUser } from '../../../../src/auth/require'
import { ApiError } from '../../../../src/errors'
import { requireOwnerHandle } from '../../../../src/projects/validators'
import { clientIp } from '../../../../src/request'
import {
  requireSocialListRate,
  requireSocialMutationRate,
  socialError,
  socialOk,
} from '../../../../src/social/limits'
import {
  followUser,
  getUserFollowState,
  resolveUserFollowTarget,
  unfollowUser,
} from '../../../../src/social/users'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const viewer = await optionalUser(ctx.request, ctx.env)
    await requireSocialListRate(
      ctx.env.RATE,
      viewer ? `user:${viewer.id}` : `ip:${clientIp(ctx.request)}`,
      'user-social',
    )
    const target = await requireTarget(ctx)
    return socialOk(await getUserFollowState(ctx.env.DB, target, viewer?.id ?? null))
  } catch (error) {
    return socialError(error)
  }
}

export const onRequestPut: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const target = await requireTarget(ctx)
    await requireSocialMutationRate(ctx.env.RATE, user.id, target.id, 'user-follow')
    await followUser(ctx.env.DB, target, user.id)
    return socialOk(await getUserFollowState(ctx.env.DB, target, user.id))
  } catch (error) {
    return socialError(error)
  }
}

export const onRequestDelete: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const target = await requireTarget(ctx)
    await requireSocialMutationRate(ctx.env.RATE, user.id, target.id, 'user-follow')
    await unfollowUser(ctx.env.DB, target, user.id)
    return socialOk(await getUserFollowState(ctx.env.DB, target, user.id))
  } catch (error) {
    return socialError(error)
  }
}

async function requireTarget(ctx: Parameters<typeof onRequestGet>[0]) {
  const target = await resolveUserFollowTarget(ctx.env.DB, requireOwnerHandle(ctx.params.handle))
  if (!target) throw new ApiError('NOT_FOUND')
  return target
}

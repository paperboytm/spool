import type { PagesFunction } from '@cloudflare/workers-types'

import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { activeTeamHandle, changeTeamHandle, validateHandle } from '../../../../src/handles'
import { requireTeamAccess } from '../../../../src/teams/auth'
import type { TeamApiEnv } from '../../../../src/teams/env'
import { requireTeamId } from '../../../../src/teams/validators'

type Params = 'teamId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id)
    return jsonOk(
      { handle: await activeTeamHandle(ctx.env.DB, teamId) },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}

export const onRequestPut: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireTeamId(ctx.params.teamId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id, 'team:identity')
    const body = (await ctx.request.json().catch(() => null)) as { handle?: unknown } | null
    const parsed = validateHandle(body?.handle)
    if (!parsed.ok) throw new ApiError('UNPROCESSABLE', parsed.reason)
    await changeTeamHandle(ctx.env.DB, {
      teamId,
      actorUserId: user.id,
      handle: parsed.handle,
      now: Date.now(),
    })
    return jsonOk(
      { handle: parsed.handle },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}

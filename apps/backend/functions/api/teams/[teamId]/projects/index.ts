import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../src/audit-after-commit'
import { requireUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { PROJECT_CREATE_RATE, PROJECT_LIST_RATE } from '../../../../../src/projects/limits'
import {
  createProjectIdempotently,
  ensureProjectTenantHandle,
  listTeamProjects,
  parseProjectListPageOptions,
  projectOwner,
  serializeProject,
  serializeProjectWithOwner,
} from '../../../../../src/projects/store'
import {
  parseCreateProjectBody,
  requireProjectIdempotencyKey,
  requireProjectTeamId,
} from '../../../../../src/projects/validators'
import { checkRate } from '../../../../../src/rate-limit'
import { requireTeamAccess } from '../../../../../src/teams/auth'
import type { TeamApiEnv } from '../../../../../src/teams/env'

type Params = 'teamId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireProjectTeamId(ctx.params.teamId)
    const access = await requireTeamAccess(ctx.env.DB, teamId, user.id)
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_LIST_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const page = await listTeamProjects(
      ctx.env.DB,
      teamId,
      user.id,
      await parseProjectListPageOptions(ctx.request, ['team-project-list', teamId, user.id]),
    )
    if (page === null) throw new ApiError('NOT_FOUND')
    const canManage = access.membership.role === 'owner' || access.membership.role === 'admin'
    const owner = page.rows[0] ? await projectOwner(ctx.env.DB, page.rows[0]) : null
    return jsonOk(
      {
        projects:
          owner === null
            ? []
            : page.rows.map((row) => serializeProjectWithOwner(row, owner, { canManage })),
        next_cursor: page.nextCursor,
      },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

export const onRequestPost: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireProjectTeamId(ctx.params.teamId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id, 'team:update')
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_CREATE_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const input = await parseCreateProjectBody(ctx.request)
    const idempotencyKey = requireProjectIdempotencyKey(ctx.request)
    const now = Date.now()
    await ensureProjectTenantHandle(ctx.env.DB, {
      actorUserId: user.id,
      tenant: { userId: null, teamId },
      now,
    })
    const result = await createProjectIdempotently(ctx.env.DB, {
      actorUserId: user.id,
      tenant: { userId: null, teamId },
      input,
      idempotencyKey,
      now,
    })
    if (!result.replayed) {
      auditAfterCommit(ctx, {
        user_id: user.id,
        action: 'project.create',
        target_id: result.project.id,
        details: { owner: 'team', team_id: teamId },
      })
    }
    return jsonOk(
      { project: await serializeProject(ctx.env.DB, result.project, { canManage: true }) },
      {
        status: result.replayed ? 200 : 201,
        headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' },
      },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

function privateProjectError(error: unknown): Response {
  const response = jsonError(error)
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private, no-store')
  headers.set('vary', 'Cookie, Authorization')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

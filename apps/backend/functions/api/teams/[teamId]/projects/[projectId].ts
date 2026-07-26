import type { PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../../src/audit-after-commit'
import { requireUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import {
  getTeamProject,
  isProjectConstraintError,
  listProjectSessions,
  parseProjectSessionPageOptions,
  serializeProject,
  updateProject,
} from '../../../../../src/projects/store'
import {
  parseUpdateProjectBody,
  requireProjectId,
  requireProjectTeamId,
} from '../../../../../src/projects/validators'
import { requireTeamAccess } from '../../../../../src/teams/auth'
import type { TeamApiEnv } from '../../../../../src/teams/env'

type Params = 'teamId' | 'projectId'

export const onRequestGet: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireProjectTeamId(ctx.params.teamId)
    const projectId = requireProjectId(ctx.params.projectId)
    const access = await requireTeamAccess(ctx.env.DB, teamId, user.id)
    const canManage = access.membership.role === 'owner' || access.membership.role === 'admin'
    const project = await getTeamProject(ctx.env.DB, projectId, teamId)
    if (!project) throw new ApiError('NOT_FOUND')
    const page = await listProjectSessions(
      ctx.env.DB,
      projectId,
      {
        kind: 'team',
        teamId,
        userId: user.id,
      },
      await parseProjectSessionPageOptions(ctx.request, [
        'team-project',
        teamId,
        user.id,
        projectId,
      ]),
    )
    return jsonOk(
      {
        project: await serializeProject(
          ctx.env.DB,
          {
            ...project,
            session_count: Number(
              (
                await ctx.env.DB.prepare(
                  'SELECT COUNT(*) AS count FROM hub_sessions WHERE project_id=? AND withdrawn_at IS NULL',
                )
                  .bind(projectId)
                  .first<{ count: number }>()
              )?.count ?? 0,
            ),
          },
          { canManage },
        ),
        sessions: await Promise.all(
          page.rows.map((row) => serializeManagedSession(ctx.env.DB, row, canManage)),
        ),
        next_cursor: page.nextCursor,
      },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

export const onRequestPatch: PagesFunction<TeamApiEnv, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const teamId = requireProjectTeamId(ctx.params.teamId)
    const projectId = requireProjectId(ctx.params.projectId)
    await requireTeamAccess(ctx.env.DB, teamId, user.id, 'team:update')
    if (!(await getTeamProject(ctx.env.DB, projectId, teamId))) {
      throw new ApiError('NOT_FOUND')
    }
    const input = await parseUpdateProjectBody(ctx.request)
    let project
    try {
      project = await updateProject(ctx.env.DB, {
        projectId,
        actorUserId: user.id,
        tenant: { userId: null, teamId },
        input,
        now: Date.now(),
      })
    } catch (error) {
      if (isProjectConstraintError(error)) {
        throw new ApiError('CONFLICT', 'Project slug is already in use')
      }
      throw error
    }
    auditAfterCommit(ctx, {
      user_id: user.id,
      action: input.archived ? 'project.archive' : 'project.update',
      target_id: projectId,
      details: { team_id: teamId },
    })
    return jsonOk(
      { project: await serializeProject(ctx.env.DB, project, { canManage: true }) },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
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

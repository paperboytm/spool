import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { serializeManagedSession } from '../../../../src/hub/management'
import {
  getPersonalProject,
  isProjectConstraintError,
  listProjectSessions,
  parseProjectSessionPageOptions,
  serializeProject,
  updateProject,
} from '../../../../src/projects/store'
import { parseUpdateProjectBody, requireProjectId } from '../../../../src/projects/validators'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'projectId'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const projectId = requireProjectId(ctx.params.projectId)
    const project = await getPersonalProject(ctx.env.DB, projectId, user.id)
    if (!project) throw new ApiError('NOT_FOUND')
    const page = await listProjectSessions(
      ctx.env.DB,
      projectId,
      {
        kind: 'personal',
        userId: user.id,
      },
      await parseProjectSessionPageOptions(ctx.request, ['personal-project', user.id, projectId]),
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
          { canManage: true },
        ),
        sessions: await Promise.all(
          page.rows.map((row) => serializeManagedSession(ctx.env.DB, row)),
        ),
        next_cursor: page.nextCursor,
      },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

export const onRequestPatch: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const projectId = requireProjectId(ctx.params.projectId)
    if (!(await getPersonalProject(ctx.env.DB, projectId, user.id))) {
      throw new ApiError('NOT_FOUND')
    }
    const input = await parseUpdateProjectBody(ctx.request)
    let project
    try {
      project = await updateProject(ctx.env.DB, {
        projectId,
        actorUserId: user.id,
        tenant: { userId: user.id, teamId: null },
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

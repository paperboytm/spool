import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { auditAfterCommit } from '../../../../src/audit-after-commit'
import { requireUser } from '../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { PROJECT_CREATE_RATE, PROJECT_LIST_RATE } from '../../../../src/projects/limits'
import {
  createProjectIdempotently,
  ensureProjectTenantHandle,
  listPersonalProjects,
  parseProjectListPageOptions,
  projectOwner,
  serializeProject,
  serializeProjectWithOwner,
} from '../../../../src/projects/store'
import {
  parseCreateProjectBody,
  requireProjectIdempotencyKey,
} from '../../../../src/projects/validators'
import { checkRate } from '../../../../src/rate-limit'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_LIST_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const page = await listPersonalProjects(
      ctx.env.DB,
      user.id,
      await parseProjectListPageOptions(ctx.request, ['personal-project-list', user.id]),
    )
    const owner = page.rows[0] ? await projectOwner(ctx.env.DB, page.rows[0]) : null
    return jsonOk(
      {
        projects:
          owner === null
            ? []
            : page.rows.map((row) => serializeProjectWithOwner(row, owner, { canManage: true })),
        next_cursor: page.nextCursor,
      },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_CREATE_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const input = await parseCreateProjectBody(ctx.request)
    const idempotencyKey = requireProjectIdempotencyKey(ctx.request)
    const now = Date.now()
    await ensureProjectTenantHandle(ctx.env.DB, {
      actorUserId: user.id,
      tenant: { userId: user.id, teamId: null },
      now,
    })
    const result = await createProjectIdempotently(ctx.env.DB, {
      actorUserId: user.id,
      tenant: { userId: user.id, teamId: null },
      input,
      idempotencyKey,
      now,
    })
    if (!result.replayed) {
      auditAfterCommit(ctx, {
        user_id: user.id,
        action: 'project.create',
        target_id: result.project.id,
        details: { owner: 'user' },
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

import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import { PROJECT_LIST_RATE } from '../../../../../src/projects/limits'
import {
  fullTenantProjectListOptions,
  listPublicProjectsForUser,
  listPublicSessionsForUser,
  listTeamProjects,
  parseProjectSessionPageOptions,
  resolveHandleOwner,
  serializeProjectWithOwner,
} from '../../../../../src/projects/store'
import { requireOwnerHandle } from '../../../../../src/projects/validators'
import { checkRate } from '../../../../../src/rate-limit'
import { clientIp } from '../../../../../src/request'

type Env = { DB: D1Database; SESSIONS: KVNamespace; RATE: KVNamespace }
type Params = 'handle'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  let privateResponse = false
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const viewer = await optionalUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, {
      ...PROJECT_LIST_RATE,
      key: viewer ? viewer.id : `ip:${clientIp(ctx.request)}`,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const owner = await resolveHandleOwner(ctx.env.DB, handle)
    if (!owner) throw new ApiError('NOT_FOUND')

    if (owner.kind === 'team') {
      privateResponse = true
      if (!viewer) throw new ApiError('NOT_FOUND')
      const projectsPage = await listTeamProjects(
        ctx.env.DB,
        owner.id,
        viewer.id,
        fullTenantProjectListOptions(),
      )
      if (projectsPage === null) throw new ApiError('NOT_FOUND')
      const membership = await ctx.env.DB.prepare(
        'SELECT role FROM team_memberships WHERE team_id=? AND user_id=?',
      )
        .bind(owner.id, viewer.id)
        .first<{ role: string }>()
      if (!membership) throw new ApiError('NOT_FOUND')
      const canManage = membership.role === 'owner' || membership.role === 'admin'
      const serializedProjects = projectsPage.rows.map((project) =>
        serializeProjectWithOwner(project, owner, { canManage }),
      )
      return jsonOk(
        {
          owner,
          projects: serializedProjects,
          session_count: 0,
          sessions: [],
          next_cursor: null,
        },
        { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
      )
    }

    const [projects, sessionsPage] = await Promise.all([
      listPublicProjectsForUser(ctx.env.DB, owner.id),
      parseProjectSessionPageOptions(ctx.request, ['owner-public-sessions', owner.id]).then(
        (options) => listPublicSessionsForUser(ctx.env.DB, owner.id, options),
      ),
    ])
    const serializedProjects = projects.map((project) =>
      serializeProjectWithOwner(project, owner, { canManage: viewer?.id === owner.id }),
    )
    return jsonOk(
      {
        owner,
        projects: serializedProjects,
        sessions: await Promise.all(
          sessionsPage.rows.map((session) => serializeManagedSession(ctx.env.DB, session, false)),
        ),
        session_count: serializedProjects.reduce(
          (count, project) => count + project.session_count,
          0,
        ),
        next_cursor: sessionsPage.nextCursor,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return privateResponse ? privateError(error) : jsonError(error)
  }
}

function privateError(error: unknown): Response {
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

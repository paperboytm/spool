import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import { PROJECT_LIST_RATE } from '../../../../../src/projects/limits'
import {
  listPublicProjectsForOwner,
  listPublicSessionsForOwner,
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

    const [projects, sessionsPage] = await Promise.all([
      listPublicProjectsForOwner(ctx.env.DB, owner),
      parseProjectSessionPageOptions(ctx.request, [
        'owner-public-sessions',
        owner.kind,
        owner.id,
      ]).then((options) => listPublicSessionsForOwner(ctx.env.DB, owner, options)),
    ])
    const canManage =
      owner.kind === 'user'
        ? viewer?.id === owner.id
        : viewer !== null &&
          (await ctx.env.DB.prepare(
            `SELECT 1 FROM team_memberships
               WHERE team_id=? AND user_id=? AND role IN ('owner','admin')`,
          )
            .bind(owner.id, viewer.id)
            .first()) !== null
    const serializedProjects = projects.map((project) =>
      serializeProjectWithOwner(project, owner, { canManage }),
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
      { headers: { 'cache-control': 'no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return noStoreError(error)
  }
}

function noStoreError(error: unknown): Response {
  const response = jsonError(error)
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'no-store')
  headers.set('vary', 'Cookie, Authorization')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

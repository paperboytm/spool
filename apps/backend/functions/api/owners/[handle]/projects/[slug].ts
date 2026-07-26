import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import {
  countPublicProjectSessions,
  getProjectBySlugForOwner,
  listPublicProjectSessions,
  parseProjectSessionPageOptions,
  resolveHandleOwner,
  serializeProject,
} from '../../../../../src/projects/store'
import { requireOwnerHandle, requireProjectSlug } from '../../../../../src/projects/validators'

type Env = { DB: D1Database; SESSIONS: KVNamespace }
type Params = 'handle' | 'slug'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const slug = requireProjectSlug(ctx.params.slug)
    const viewer = await optionalUser(ctx.request, ctx.env)
    const owner = await resolveHandleOwner(ctx.env.DB, handle)
    if (!owner) throw new ApiError('NOT_FOUND')

    const project = await getProjectBySlugForOwner(ctx.env.DB, owner, slug)
    if (!project) throw new ApiError('NOT_FOUND')
    const publicCount = await countPublicProjectSessions(ctx.env.DB, project.id, owner)
    // A Team namespace becomes public only through a live Public Session.
    // Private Team Projects stay exclusively on /api/teams/:teamId/projects.
    if (owner.kind === 'team' && publicCount === 0) throw new ApiError('NOT_FOUND')
    const page = await listPublicProjectSessions(
      ctx.env.DB,
      project.id,
      owner,
      await parseProjectSessionPageOptions(ctx.request, [
        'owner-public-project',
        owner.kind,
        owner.id,
        project.id,
      ]),
    )
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
    return jsonOk(
      {
        owner,
        project: await serializeProject(
          ctx.env.DB,
          {
            ...project,
            session_count: publicCount,
          },
          { canManage },
        ),
        sessions: await Promise.all(
          page.rows.map((session) => serializeManagedSession(ctx.env.DB, session, false)),
        ),
        next_cursor: page.nextCursor,
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

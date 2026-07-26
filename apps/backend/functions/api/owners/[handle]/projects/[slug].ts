import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../src/auth/require'
import { ApiError, jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import {
  getProjectBySlugForOwner,
  listProjectSessions,
  listPublicProjectSessions,
  parseProjectSessionPageOptions,
  resolveHandleOwner,
  serializeProject,
} from '../../../../../src/projects/store'
import { requireOwnerHandle, requireProjectSlug } from '../../../../../src/projects/validators'

type Env = { DB: D1Database; SESSIONS: KVNamespace }
type Params = 'handle' | 'slug'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  let privateResponse = false
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const slug = requireProjectSlug(ctx.params.slug)
    const viewer = await optionalUser(ctx.request, ctx.env)
    const owner = await resolveHandleOwner(ctx.env.DB, handle)
    if (!owner) throw new ApiError('NOT_FOUND')

    if (owner.kind === 'team') {
      privateResponse = true
      if (!viewer) throw new ApiError('NOT_FOUND')
      const membership = await ctx.env.DB.prepare(
        `SELECT m.role FROM team_memberships m
         JOIN teams t ON t.id=m.team_id
         WHERE m.team_id=? AND m.user_id=?
           AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL`,
      )
        .bind(owner.id, viewer.id)
        .first<{ role: string }>()
      if (!membership) throw new ApiError('NOT_FOUND')
      const project = await getProjectBySlugForOwner(ctx.env.DB, owner, slug)
      if (!project) throw new ApiError('NOT_FOUND')
      const page = await listProjectSessions(
        ctx.env.DB,
        project.id,
        {
          kind: 'team',
          teamId: owner.id,
          userId: viewer.id,
        },
        await parseProjectSessionPageOptions(ctx.request, [
          'owner-team-project',
          owner.id,
          viewer.id,
          project.id,
        ]),
      )
      const canManage = membership.role === 'owner' || membership.role === 'admin'
      return jsonOk(
        {
          owner,
          project: await serializeProject(
            ctx.env.DB,
            {
              ...project,
              session_count: Number(
                (
                  await ctx.env.DB.prepare(
                    'SELECT COUNT(*) AS count FROM hub_sessions WHERE project_id=? AND withdrawn_at IS NULL',
                  )
                    .bind(project.id)
                    .first<{ count: number }>()
                )?.count ?? 0,
              ),
            },
            { canManage },
          ),
          sessions: await Promise.all(
            page.rows.map((session) => serializeManagedSession(ctx.env.DB, session, canManage)),
          ),
          next_cursor: page.nextCursor,
        },
        { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
      )
    }

    const project = await getProjectBySlugForOwner(ctx.env.DB, owner, slug)
    if (!project) throw new ApiError('NOT_FOUND')
    const page = await listPublicProjectSessions(
      ctx.env.DB,
      project.id,
      owner.id,
      await parseProjectSessionPageOptions(ctx.request, [
        'owner-public-project',
        owner.id,
        project.id,
      ]),
    )
    const publicCount = Number(
      (
        await ctx.env.DB.prepare(
          `SELECT COUNT(*) AS count
             FROM hub_sessions s
             JOIN hub_session_discovery d ON d.sid=s.sid
             WHERE s.project_id=? AND s.owner_user_id=?
               AND s.team_id IS NULL AND s.visibility='unlisted'
               AND s.withdrawn_at IS NULL`,
        )
          .bind(project.id, owner.id)
          .first<{ count: number }>()
      )?.count ?? 0,
    )
    return jsonOk(
      {
        owner,
        project: await serializeProject(
          ctx.env.DB,
          {
            ...project,
            session_count: publicCount,
          },
          { canManage: viewer?.id === owner.id },
        ),
        sessions: await Promise.all(
          page.rows.map((session) => serializeManagedSession(ctx.env.DB, session, false)),
        ),
        next_cursor: page.nextCursor,
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

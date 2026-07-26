import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { optionalUser } from '../../../../../src/auth/require'
import { jsonError, jsonOk } from '../../../../../src/errors'
import { serializeManagedSession } from '../../../../../src/hub/management'
import {
  listPublicProjectSessions,
  parseProjectSessionPageOptions,
  serializeProjectWithOwner,
} from '../../../../../src/projects/store'
import { requireOwnerHandle, requireProjectSlug } from '../../../../../src/projects/validators'

type Env = { DB: D1Database; SESSIONS: KVNamespace }
type Params = 'handle' | 'slug'

export const onRequestGet: PagesFunction<Env, Params> = async (ctx) => {
  try {
    const handle = requireOwnerHandle(ctx.params.handle)
    const slug = requireProjectSlug(ctx.params.slug)
    const viewer = await optionalUser(ctx.request, ctx.env)
    const page = await listPublicProjectSessions(
      ctx.env.DB,
      handle,
      slug,
      await parseProjectSessionPageOptions(ctx.request, ['owner-public-project', handle, slug]),
    )
    const { owner, project } = page
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
        project: serializeProjectWithOwner(project, owner, { canManage }),
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

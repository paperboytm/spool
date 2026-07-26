import type { PagesFunction } from '@cloudflare/workers-types'
import { z } from 'zod'

import { ApiError, jsonError, jsonOk } from '../../../../src/errors'
import { requireHubUser } from '../../../../src/hub/auth'
import { activeTeamRole, type HubEnv } from '../../../../src/hub/head'
import { TEAM_ID_RE } from '../../../../src/hub/wire'
import { PROJECT_CREATE_RATE, PROJECT_LIST_RATE } from '../../../../src/projects/limits'
import {
  createProjectIdempotently,
  ensureProjectTenantHandle,
  listHubProjectsForUser,
  parseProjectListPageOptions,
  serializeHubProject,
  serializeProject,
} from '../../../../src/projects/store'
import {
  CreateProjectBody,
  requireProjectIdempotencyKey,
  slugFromName,
} from '../../../../src/projects/validators'
import { checkRate } from '../../../../src/rate-limit'

const HubProjectOwner = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), id: z.string().min(1).max(192) }).strict(),
  z.object({ kind: z.literal('team'), id: z.string().regex(TEAM_ID_RE) }).strict(),
])

const HubCreateProjectBody = CreateProjectBody.extend({
  owner: HubProjectOwner.optional(),
  // Rolling-upgrade alias for clients from the first Projects preview.
  teamId: z.string().regex(TEAM_ID_RE).nullable().optional(),
  idempotency_key: z.string().optional(),
})
  .strict()
  .superRefine((value, ctx) => {
    if (value.owner === undefined && value.teamId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['owner'],
        message: 'owner is required',
      })
      return
    }
    if (
      value.owner !== undefined &&
      value.teamId !== undefined &&
      (value.owner.kind !== (value.teamId === null ? 'user' : 'team') ||
        (value.owner.kind === 'team' && value.owner.id !== value.teamId))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['owner'],
        message: 'owner and teamId must identify the same tenant',
      })
    }
  })

export const onRequestGet: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_LIST_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const page = await listHubProjectsForUser(
      ctx.env.DB,
      user.id,
      await parseProjectListPageOptions(ctx.request, ['hub-project-list', user.id]),
    )
    return jsonOk(
      {
        actor: { id: user.id },
        projects: page.rows.map(serializeHubProject),
        next_cursor: page.nextCursor,
      },
      { headers: { 'cache-control': 'private, no-store', vary: 'Cookie, Authorization' } },
    )
  } catch (error) {
    return privateProjectError(error)
  }
}

export const onRequestPost: PagesFunction<HubEnv> = async (ctx) => {
  try {
    const user = await requireHubUser(ctx.request, ctx.env)
    const rate = await checkRate(ctx.env.RATE, { ...PROJECT_CREATE_RATE, key: user.id })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const parsed = HubCreateProjectBody.safeParse(await readJson(ctx.request))
    if (!parsed.success) {
      throw new ApiError('UNPROCESSABLE', 'invalid Project', { issues: parsed.error.issues })
    }
    const idempotencyKey = requireProjectIdempotencyKey(ctx.request, parsed.data.idempotency_key)
    const canonicalOwner =
      parsed.data.owner ??
      (parsed.data.teamId === null
        ? { kind: 'user' as const, id: user.id }
        : { kind: 'team' as const, id: parsed.data.teamId! })
    if (canonicalOwner.kind === 'user' && canonicalOwner.id !== user.id) {
      throw new ApiError('NOT_FOUND')
    }
    const teamId = canonicalOwner.kind === 'team' ? canonicalOwner.id : null
    const teamRole = teamId === null ? null : await activeTeamRole(ctx.env.DB, teamId, user.id)
    if (teamId !== null && teamRole !== 'owner' && teamRole !== 'admin') {
      throw new ApiError(teamRole === null ? 'NOT_FOUND' : 'FORBIDDEN')
    }
    const now = Date.now()
    await ensureProjectTenantHandle(ctx.env.DB, {
      actorUserId: user.id,
      tenant: teamId === null ? { userId: user.id, teamId: null } : { userId: null, teamId },
      now,
    })
    const input = {
      name: parsed.data.name,
      slug: parsed.data.slug ?? slugFromName(parsed.data.name),
      description: parsed.data.description,
      github_url: parsed.data.github_url,
    }
    const tenant =
      teamId === null
        ? ({ userId: user.id, teamId: null } as const)
        : ({ userId: null, teamId } as const)
    const result = await createProjectIdempotently(ctx.env.DB, {
      actorUserId: user.id,
      tenant,
      input,
      idempotencyKey,
      now,
    })
    return jsonOk(
      {
        project: await serializeProject(ctx.env.DB, result.project, { canManage: true }),
      },
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

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
}

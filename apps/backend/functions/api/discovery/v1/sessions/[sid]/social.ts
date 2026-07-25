import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { COOKIE_NAME, readCookie } from '../../../../../../src/auth/cookie'
import { requireUser } from '../../../../../../src/auth/require'
import { loadSession } from '../../../../../../src/auth/session'
import {
  getDiscoverySessionSocial,
  starDiscoverySession,
  unstarDiscoverySession,
} from '../../../../../../src/discovery/social'
import { ApiError, jsonError, jsonOk } from '../../../../../../src/errors'
import { requireSid } from '../../../../../../src/hub/wire'
import { checkRate } from '../../../../../../src/rate-limit'
import { getUserById } from '../../../../../../src/store/d1'

type DiscoverySocialEnv = {
  DB: D1Database
  RATE: KVNamespace
  SESSIONS: KVNamespace
}

const SOCIAL_MUTATION_GLOBAL_RATE = {
  bucket: 'discovery-social-user-h',
  windowSec: 60 * 60,
  max: 300,
}

const SOCIAL_MUTATION_TARGET_RATE = {
  bucket: 'discovery-social-target-h',
  windowSec: 60 * 60,
  max: 60,
}

const SOCIAL_RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  vary: 'Cookie, Authorization',
}

export const onRequestGet: PagesFunction<DiscoverySocialEnv> = async (ctx) => {
  try {
    const sid = requireSid(ctx.params['sid'])
    const viewerUserId = await optionalViewerUserId(ctx.request, ctx.env)
    return socialOk(await getDiscoverySessionSocial(ctx.env.DB, sid, viewerUserId))
  } catch (error) {
    return socialError(error)
  }
}

export const onRequestPut: PagesFunction<DiscoverySocialEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])
    await requireSocialMutationRate(ctx.env.RATE, user.id, sid)
    return socialOk(await starDiscoverySession(ctx.env.DB, sid, user.id))
  } catch (error) {
    return socialError(error)
  }
}

export const onRequestDelete: PagesFunction<DiscoverySocialEnv> = async (ctx) => {
  try {
    const user = await requireUser(ctx.request, ctx.env)
    const sid = requireSid(ctx.params['sid'])
    await requireSocialMutationRate(ctx.env.RATE, user.id, sid)
    return socialOk(await unstarDiscoverySession(ctx.env.DB, sid, user.id))
  } catch (error) {
    return socialError(error)
  }
}

async function optionalViewerUserId(
  request: Request,
  env: DiscoverySocialEnv,
): Promise<string | null> {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const token = bearer ?? readCookie(request, COOKIE_NAME)
  if (!token) return null
  const session = await loadSession(env.SESSIONS, token)
  if (!session) return null
  const user = await getUserById(env.DB, session.user_id)
  return user && user.deletion_pending_until === null ? user.id : null
}

async function requireSocialMutationRate(
  rate: KVNamespace,
  userId: string,
  sid: string,
): Promise<void> {
  const global = await checkRate(rate, {
    ...SOCIAL_MUTATION_GLOBAL_RATE,
    key: userId,
  })
  if (!global.ok) throw new ApiError('TOO_MANY_REQUESTS')

  const target = await checkRate(rate, {
    ...SOCIAL_MUTATION_TARGET_RATE,
    key: `${userId}:${sid}`,
  })
  if (!target.ok) throw new ApiError('TOO_MANY_REQUESTS')
}

function socialOk(body: unknown): Response {
  return jsonOk(body, { headers: SOCIAL_RESPONSE_HEADERS })
}

function socialError(error: unknown): Response {
  const response = jsonError(error)
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SOCIAL_RESPONSE_HEADERS)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

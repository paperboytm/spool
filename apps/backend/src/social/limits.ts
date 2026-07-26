import type { KVNamespace } from '@cloudflare/workers-types'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { ApiError, jsonError, jsonOk } from '../errors'
import { checkRate } from '../rate-limit'

export const SOCIAL_RESPONSE_HEADERS = {
  'cache-control': 'no-store',
  vary: 'Cookie, Authorization',
}

const SOCIAL_MUTATION_GLOBAL_RATE = {
  windowSec: 60 * 60,
  max: 300,
}

const SOCIAL_MUTATION_TARGET_RATE = {
  windowSec: 60 * 60,
  max: 60,
}

const SOCIAL_LIST_RATE = {
  windowSec: 60,
  max: 120,
}

const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 50
const CURSOR_VERSION = 1

export type SocialListOptions = {
  after: { createdAt: number; id: string } | null
  fingerprint: string
  limit: number
}

export type SocialListPage<Row> = {
  rows: Row[]
  nextCursor: string | null
}

export async function requireSocialMutationRate(
  rate: KVNamespace,
  actorUserId: string,
  target: string,
  kind: 'project-star' | 'project-watch' | 'user-follow',
): Promise<void> {
  const global = await checkRate(rate, {
    ...SOCIAL_MUTATION_GLOBAL_RATE,
    bucket: `${kind}-user-h`,
    key: actorUserId,
  })
  if (!global.ok) throw new ApiError('TOO_MANY_REQUESTS')

  const perTarget = await checkRate(rate, {
    ...SOCIAL_MUTATION_TARGET_RATE,
    bucket: `${kind}-target-h`,
    key: `${actorUserId}:${target}`,
  })
  if (!perTarget.ok) throw new ApiError('TOO_MANY_REQUESTS')
}

export async function requireSocialListRate(
  rate: KVNamespace,
  key: string,
  kind:
    | 'project-stargazers'
    | 'project-social'
    | 'owner-starred-projects'
    | 'starred-projects'
    | 'user-social'
    | 'watching-projects'
    | 'user-graph',
): Promise<void> {
  const result = await checkRate(rate, {
    ...SOCIAL_LIST_RATE,
    bucket: `${kind}-m`,
    key,
  })
  if (!result.ok) throw new ApiError('TOO_MANY_REQUESTS')
}

export async function parseSocialListOptions(
  request: Request,
  scope: readonly string[],
): Promise<SocialListOptions> {
  const url = new URL(request.url)
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    throw new ApiError('BAD_REQUEST', 'cursor and limit may be provided at most once')
  }

  const rawLimit = url.searchParams.get('limit')
  let limit = DEFAULT_LIST_LIMIT
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) throw new ApiError('BAD_REQUEST', 'invalid limit')
    limit = Number(rawLimit)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
      throw new ApiError('BAD_REQUEST', `limit must be between 1 and ${MAX_LIST_LIMIT}`)
    }
  }

  const fingerprint = base64urlFromBuffer(await sha256(JSON.stringify(scope))).slice(0, 16)
  const cursor = url.searchParams.get('cursor')
  return {
    after: cursor === null ? null : decodeCursor(cursor, fingerprint),
    fingerprint,
    limit,
  }
}

export function finishSocialListPage<Row extends { social_created_at: number; social_id: string }>(
  rows: Row[],
  options: SocialListOptions,
): SocialListPage<Row> {
  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page.at(-1)
  return {
    rows: page,
    nextCursor:
      hasMore && last
        ? encodeCursor(
            {
              createdAt: last.social_created_at,
              id: last.social_id,
            },
            options.fingerprint,
          )
        : null,
  }
}

export function socialOk(
  body: unknown,
  init: { private?: boolean; status?: number } = {},
): Response {
  return jsonOk(body, {
    ...(init.status === undefined ? {} : { status: init.status }),
    headers: {
      ...SOCIAL_RESPONSE_HEADERS,
      ...(init.private ? { 'cache-control': 'private, no-store' } : {}),
    },
  })
}

export function socialError(error: unknown): Response {
  const response = jsonError(error)
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SOCIAL_RESPONSE_HEADERS)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function encodeCursor(value: { createdAt: number; id: string }, fingerprint: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: CURSOR_VERSION,
      f: fingerprint,
      t: value.createdAt,
      i: value.id,
    }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeCursor(value: string, fingerprint: string): { createdAt: number; id: string } {
  if (value.length > 768 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
    ) as Record<string, unknown>
    if (
      parsed['v'] !== CURSOR_VERSION ||
      parsed['f'] !== fingerprint ||
      typeof parsed['t'] !== 'number' ||
      !Number.isSafeInteger(parsed['t']) ||
      parsed['t'] < 0 ||
      typeof parsed['i'] !== 'string' ||
      parsed['i'].length < 1 ||
      parsed['i'].length > 256
    ) {
      throw new Error('invalid')
    }
    return { createdAt: parsed['t'], id: parsed['i'] }
  } catch {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
}

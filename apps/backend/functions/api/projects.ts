import type { D1Database, KVNamespace, PagesFunction } from '@cloudflare/workers-types'

import { base64urlFromBuffer } from '../../src/auth/pkce'
import { ApiError, jsonError, jsonOk } from '../../src/errors'
import { PROJECT_LIST_RATE } from '../../src/projects/limits'
import {
  listPublicProjects,
  serializePublicProject,
  type PublicProjectCursor,
} from '../../src/projects/store'
import { checkRate } from '../../src/rate-limit'
import { clientIp } from '../../src/request'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50

type Env = { DB: D1Database; RATE: KVNamespace }

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  try {
    const rate = await checkRate(ctx.env.RATE, {
      ...PROJECT_LIST_RATE,
      key: `ip:${clientIp(ctx.request)}`,
    })
    if (!rate.ok) throw new ApiError('TOO_MANY_REQUESTS')
    const { cursor, limit } = parseOptions(ctx.request)
    const rows = await listPublicProjects(ctx.env.DB, { after: cursor, limit })
    const hasMore = rows.length > limit
    const page = hasMore ? rows.slice(0, limit) : rows
    const last = page.at(-1)
    return jsonOk(
      {
        projects: page.map((row) => ({
          ...serializePublicProject(row),
          last_session_at: row.last_session_at,
        })),
        next_cursor:
          hasMore && last
            ? encodeCursor({ lastSessionAt: last.last_session_at, id: last.id })
            : null,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (error) {
    return jsonError(error)
  }
}

function parseOptions(request: Request): { cursor: PublicProjectCursor | null; limit: number } {
  const url = new URL(request.url)
  if (url.searchParams.getAll('cursor').length > 1 || url.searchParams.getAll('limit').length > 1) {
    throw new ApiError('BAD_REQUEST', 'cursor and limit may be provided at most once')
  }
  const cursorValue = url.searchParams.get('cursor')
  const limitValue = url.searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitValue !== null) {
    if (!/^\d+$/.test(limitValue)) throw new ApiError('BAD_REQUEST', 'invalid limit')
    limit = Number(limitValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ApiError('BAD_REQUEST', `limit must be between 1 and ${MAX_LIMIT}`)
    }
  }
  return { cursor: cursorValue === null ? null : decodeCursor(cursorValue), limit }
}

function encodeCursor(value: PublicProjectCursor): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ v: 1, t: value.lastSessionAt, i: value.id }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeCursor(value: string): PublicProjectCursor {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
    const parsed = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
    ) as Record<string, unknown>
    if (
      parsed['v'] !== 1 ||
      typeof parsed['t'] !== 'number' ||
      !Number.isSafeInteger(parsed['t']) ||
      parsed['t'] < 0 ||
      typeof parsed['i'] !== 'string' ||
      parsed['i'].length > 256
    ) {
      throw new Error('invalid')
    }
    return { lastSessionAt: parsed['t'], id: parsed['i'] }
  } catch {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }
}

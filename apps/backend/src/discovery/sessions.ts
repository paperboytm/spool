import type { D1Database } from '@cloudflare/workers-types'
import type {
  DiscoverySessionItem,
  DiscoverySessionsResponse,
  DiscoverySort,
  SessionProvider,
} from '@spool-lab/session-kit'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { ApiError } from '../errors'
import { listDiscoveryPage, type DiscoveryCandidateRow, type DiscoveryPageKey } from './store'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const SUMMARY_EXCERPT_CHARS = 360
const DAY_MS = 24 * 60 * 60 * 1000
const CURSOR_VERSION = 2

type ListOptions = {
  q: string | null
  sort: DiscoverySort
  agent: SessionProvider | null
  limit: number
  fingerprint: string
  rankedAt: number
  after: DiscoveryPageKey | null
}

// Discovery contains disclosure-sensitive metadata. A Public -> Team change
// must disappear on the next request, so neither browsers nor shared edge
// caches may serve a stale list assembled before the transition.
export const DISCOVERY_CACHE_CONTROL = 'no-store'

export async function listDiscoverySessions(
  db: D1Database,
  request: Request,
  now = Date.now(),
): Promise<DiscoverySessionsResponse> {
  const options = await parseListOptions(new URL(request.url), now)
  const tokens = options.q === null ? [] : tokenize(options.q)
  const rows = await listDiscoveryPage(db, {
    query: options.q,
    tokens,
    sort: options.sort,
    agent: options.agent,
    rankedAt: options.rankedAt,
    // Using the seven completed UTC days makes every score stable for the
    // lifetime of a cursor while retaining the intended seven-day signal.
    engagementFromDay: utcDay(options.rankedAt - 7 * DAY_MS),
    engagementToDayExclusive: utcDay(options.rankedAt),
    after: options.after,
    limit: options.limit,
  })

  const hasMore = rows.length > options.limit
  const page = hasMore ? rows.slice(0, options.limit) : rows
  const last = page.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeCursor(
          {
            rankedAt: options.rankedAt,
            relevanceScore: last.relevance_score,
            sortScore: last.sort_score,
            publishedAt: last.published_at,
            sid: last.sid,
          },
          options.fingerprint,
        )
      : null

  return {
    version: 1,
    items: page.map(toDiscoveryItem),
    nextCursor,
  }
}

async function parseListOptions(url: URL, now: number): Promise<ListOptions> {
  rejectDuplicate(url, 'q')
  rejectDuplicate(url, 'sort')
  rejectDuplicate(url, 'agent')
  rejectDuplicate(url, 'limit')
  rejectDuplicate(url, 'cursor')

  let q: string | null = null
  if (url.searchParams.has('q')) {
    q = (url.searchParams.get('q') ?? '').trim().normalize('NFKC').toLowerCase()
    const length = Array.from(q).length
    if (length < 1 || length > 120) {
      throw new ApiError('BAD_REQUEST', 'q must be between 1 and 120 characters')
    }
  }

  const sortValue = url.searchParams.get('sort') ?? 'recommended'
  if (!isDiscoverySort(sortValue)) {
    throw new ApiError('BAD_REQUEST', 'sort must be recommended, trending, or recent')
  }

  const agentValue = url.searchParams.get('agent')
  if (agentValue !== null && agentValue !== 'claude' && agentValue !== 'codex') {
    throw new ApiError('BAD_REQUEST', 'agent must be claude or codex')
  }
  const agent: SessionProvider | null = agentValue

  const limitValue = url.searchParams.get('limit')
  let limit = DEFAULT_LIMIT
  if (limitValue !== null) {
    if (!/^\d+$/.test(limitValue)) {
      throw new ApiError('BAD_REQUEST', `limit must be an integer from 1 to ${MAX_LIMIT}`)
    }
    limit = Number(limitValue)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new ApiError('BAD_REQUEST', `limit must be an integer from 1 to ${MAX_LIMIT}`)
    }
  }

  const fingerprint = await queryFingerprint(q, sortValue, agent)
  const cursorValue = url.searchParams.get('cursor')
  const after = cursorValue === null ? null : decodeCursor(cursorValue, fingerprint, sortValue, now)
  return {
    q,
    sort: sortValue,
    agent,
    limit,
    fingerprint,
    rankedAt: after?.rankedAt ?? now,
    after,
  }
}

function rejectDuplicate(url: URL, name: string): void {
  if (url.searchParams.getAll(name).length > 1) {
    throw new ApiError('BAD_REQUEST', `${name} must be provided at most once`)
  }
}

function tokenize(query: string): string[] {
  return query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5)
}

async function queryFingerprint(
  q: string | null,
  sort: DiscoverySort,
  agent: SessionProvider | null,
): Promise<string> {
  return base64urlFromBuffer(await sha256(JSON.stringify([q, sort, agent]))).slice(0, 16)
}

function encodeCursor(key: DiscoveryPageKey, fingerprint: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: CURSOR_VERSION,
      f: fingerprint,
      a: key.rankedAt,
      r: key.relevanceScore,
      s: key.sortScore,
      p: key.publishedAt,
      i: key.sid,
    }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeCursor(
  value: string,
  expectedFingerprint: string,
  sort: DiscoverySort,
  now: number,
): DiscoveryPageKey {
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }

  let decoded: unknown
  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new ApiError('BAD_REQUEST', 'malformed cursor')
  }

  if (
    !isObject(decoded) ||
    decoded['v'] !== CURSOR_VERSION ||
    decoded['f'] !== expectedFingerprint ||
    !isNonNegativeSafeInteger(decoded['a']) ||
    decoded['a'] > now + 5 * 60 * 1000 ||
    !isNonNegativeSafeInteger(decoded['r']) ||
    !isNonNegativeSafeInteger(decoded['p']) ||
    typeof decoded['i'] !== 'string' ||
    decoded['i'].length < 1 ||
    decoded['i'].length > 128 ||
    (sort === 'recent' ? decoded['s'] !== null : !isNonNegativeSafeInteger(decoded['s']))
  ) {
    throw new ApiError('BAD_REQUEST', 'malformed or mismatched cursor')
  }
  return {
    rankedAt: decoded['a'],
    relevanceScore: decoded['r'],
    sortScore: sort === 'recent' ? null : (decoded['s'] as number),
    publishedAt: decoded['p'],
    sid: decoded['i'],
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function toDiscoveryItem(row: DiscoveryCandidateRow): DiscoverySessionItem {
  const avatarVisible = row.avatar_visible === 1
  const avatarUrl = !avatarVisible
    ? null
    : row.custom_avatar_id
      ? `/api/avatars/${encodeURIComponent(row.owner_user_id)}?v=${encodeURIComponent(row.custom_avatar_id)}`
      : row.avatar_url
  return {
    sid: row.sid,
    title: row.title,
    summaryExcerpt:
      row.summary_text === null
        ? null
        : Array.from(row.summary_text).slice(0, SUMMARY_EXCERPT_CHARS).join(''),
    agent: row.agent,
    author: {
      handle: row.handle,
      displayName: row.display_name ?? row.name,
      avatarUrl,
    },
    evidence: {
      records: row.record_count,
      messages: row.message_count,
      toolCalls: row.tool_call_count,
      files: row.file_count,
      additions: row.additions,
      deletions: row.deletions,
    },
    lineage: row.lineage_source_sid === null ? null : { sourceSid: row.lineage_source_sid },
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
  }
}

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function isDiscoverySort(value: string): value is DiscoverySort {
  return value === 'recommended' || value === 'trending' || value === 'recent'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

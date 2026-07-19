import type { D1Database } from '@cloudflare/workers-types'
import type {
  DiscoverySessionItem,
  DiscoverySessionsResponse,
  DiscoverySort,
  SessionProvider,
} from '@spool-lab/session-kit'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { ApiError } from '../errors'
import { listDiscoveryCandidates, type DiscoveryCandidateRow } from './store'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const CANDIDATE_LIMIT = 200
const SUMMARY_EXCERPT_CHARS = 360
const DAY_MS = 24 * 60 * 60 * 1000
const CURSOR_VERSION = 1

type ListOptions = {
  q: string | null
  sort: DiscoverySort
  agent: SessionProvider | null
  limit: number
  offset: number
  fingerprint: string
}

export const DISCOVERY_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30'

export async function listDiscoverySessions(
  db: D1Database,
  request: Request,
  now = Date.now(),
): Promise<DiscoverySessionsResponse> {
  const options = await parseListOptions(new URL(request.url))
  const tokens = options.q === null ? [] : tokenize(options.q)
  const rows = await listDiscoveryCandidates(db, {
    sinceDay: utcDay(now - 6 * DAY_MS),
    agent: options.agent,
    tokens,
    limit: CANDIDATE_LIMIT,
  })

  const ranked = rows
    .slice()
    .sort((left, right) => compareCandidates(left, right, options.sort, options.q, tokens, now))
  const page = ranked.slice(options.offset, options.offset + options.limit)
  const nextOffset = options.offset + page.length
  const nextCursor =
    page.length > 0 && nextOffset < ranked.length
      ? encodeCursor(nextOffset, options.fingerprint)
      : null

  return {
    version: 1,
    items: page.map(toDiscoveryItem),
    nextCursor,
  }
}

async function parseListOptions(url: URL): Promise<ListOptions> {
  rejectDuplicate(url, 'q')
  rejectDuplicate(url, 'sort')
  rejectDuplicate(url, 'agent')
  rejectDuplicate(url, 'limit')
  rejectDuplicate(url, 'cursor')

  let q: string | null = null
  if (url.searchParams.has('q')) {
    q = (url.searchParams.get('q') ?? '').trim()
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
  const offset = cursorValue === null ? 0 : decodeCursor(cursorValue, fingerprint)
  return { q, sort: sortValue, agent, limit, offset, fingerprint }
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

function encodeCursor(offset: number, fingerprint: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ v: CURSOR_VERSION, o: offset, f: fingerprint }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function decodeCursor(value: string, expectedFingerprint: string): number {
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
    !Number.isSafeInteger(decoded['o']) ||
    typeof decoded['o'] !== 'number' ||
    decoded['o'] < 0 ||
    decoded['o'] > CANDIDATE_LIMIT ||
    decoded['f'] !== expectedFingerprint
  ) {
    throw new ApiError('BAD_REQUEST', 'malformed or mismatched cursor')
  }
  return decoded['o']
}

function compareCandidates(
  left: DiscoveryCandidateRow,
  right: DiscoveryCandidateRow,
  sort: DiscoverySort,
  query: string | null,
  tokens: readonly string[],
  now: number,
): number {
  if (query !== null) {
    const relevance = relevanceScore(right, query, tokens) - relevanceScore(left, query, tokens)
    if (relevance !== 0) return relevance
  }
  return compareSelectedSort(left, right, sort, now)
}

function compareSelectedSort(
  left: DiscoveryCandidateRow,
  right: DiscoveryCandidateRow,
  sort: DiscoverySort,
  now: number,
): number {
  if (sort !== 'recent') {
    const leftScore = rankingScore(left, sort, now)
    const rightScore = rankingScore(right, sort, now)
    if (leftScore !== rightScore) return rightScore - leftScore
  }
  if (left.published_at !== right.published_at) return right.published_at - left.published_at
  return left.sid.localeCompare(right.sid)
}

function rankingScore(
  row: DiscoveryCandidateRow,
  sort: Exclude<DiscoverySort, 'recent'>,
  now: number,
): number {
  const ageDays = Math.max(0, (now - row.published_at) / DAY_MS)
  const reads = Math.max(0, row.qualified_reads_7d)
  if (sort === 'recommended') {
    return row.quality_score + 8 * Math.log1p(reads) + 12 * 2 ** (-ageDays / 14)
  }
  return Math.log1p(reads) * 2 ** (-ageDays / 7) + 0.05 * row.quality_score
}

function relevanceScore(
  row: DiscoveryCandidateRow,
  query: string,
  tokens: readonly string[],
): number {
  const phrase = query.normalize('NFKC').toLowerCase()
  const title = row.title.toLowerCase()
  const summary = (row.summary_text ?? '').toLowerCase()
  const author = `${row.handle ?? ''} ${row.display_name ?? row.name ?? ''}`.toLowerCase()
  let score = 0
  if (title === phrase) score += 10_000
  else if (title.includes(phrase)) score += 5_000
  if (summary.includes(phrase)) score += 1_000
  if (author.trim() === phrase) score += 2_000
  else if (author.includes(phrase)) score += 500
  for (const token of tokens) {
    if (title.includes(token)) score += 200
    if (summary.includes(token)) score += 80
    if (author.includes(token)) score += 100
    if (row.search_text.includes(token)) score += 20
  }
  return score
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

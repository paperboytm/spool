import type { D1Database, D1PreparedStatement, R2Bucket } from '@cloudflare/workers-types'
import type { SessionProvider, SessionViewV1 } from '@spool-lab/session-kit'

import { ApiError } from '../errors'
import { readObjects } from '../hub/packs'
import { locateObjects } from '../hub/store'
import { SID_RE } from '../hub/wire'

const MAX_VIEW_BYTES = 8 * 1024 * 1024
const MAX_VIEW_ENTRIES = 100_000
const MAX_TITLE_CHARS = 200
const MAX_SUMMARY_CHARS = 4_000
const MAX_SEARCH_BYTES = 16 * 1024
const encoder = new TextEncoder()

export type DiscoveryProjection = {
  sid: string
  agent: SessionProvider
  title: string
  summaryText: string | null
  searchText: string
  messageCount: number
  toolCallCount: number
  fileCount: number
  additions: number
  deletions: number
  lineageSourceSid: string | null
  qualityScore: number
  publishedAt: number
  updatedAt: number
}

export async function readDiscoveryView(
  db: D1Database,
  bucket: R2Bucket,
  ownerUserId: string,
  viewOid: string,
): Promise<SessionViewV1> {
  const located = await locateObjects(db, ownerUserId, [viewOid])
  const location = located.get(viewOid)
  if (!location) throw new ApiError('INTERNAL', 'view object missing')
  if (location.length > MAX_VIEW_BYTES) {
    throw new ApiError('UNPROCESSABLE', 'view object exceeds the 8 MB limit')
  }

  const objects = await readObjects(bucket, [location])
  const body = objects.get(viewOid)
  if (body === undefined) throw new ApiError('INTERNAL', 'view object unreadable')

  let value: unknown
  try {
    value = JSON.parse(body) as unknown
  } catch {
    throw new ApiError('UNPROCESSABLE', 'invalid session view')
  }
  if (!isSessionViewV1(value)) throw new ApiError('UNPROCESSABLE', 'invalid session view')
  return value
}

export function buildDiscoveryProjection(args: {
  sid: string
  summaryMd: string | null
  lineageJson: string | null
  recordCount: number
  publishedAt: number
  updatedAt: number
  view: SessionViewV1
}): DiscoveryProjection {
  const agent = providerFromSid(args.sid)
  const summaryTextValue = markdownToPlainText(args.summaryMd ?? '')
  const summaryText = summaryTextValue ? boundCharacters(summaryTextValue, MAX_SUMMARY_CHARS) : null
  const promptTitle = firstNonEmptyLine(args.view.firstPrompt)
  const summaryTitle = firstMeaningfulSummaryLine(args.summaryMd)
  const contentTitle = promptTitle || summaryTitle
  const title = boundCharacters(contentTitle || fallbackTitle(agent), MAX_TITLE_CHARS)
  const messageCount = args.view.index.filter(
    (entry) => entry.kind === 'user' || entry.kind === 'assistant',
  ).length
  const toolCallCount = args.view.index.filter(
    (entry) => entry.kind === 'tool' || entry.kind === 'edit',
  ).length
  const fileCount = args.view.diffstat.files

  const qualityScore =
    (summaryText === null ? 0 : 6) +
    (contentTitle ? 4 : 0) +
    (fileCount > 0 ? 4 : 0) +
    (messageCount >= 2 ? 2 : 0) +
    (toolCallCount > 0 ? 2 : 0) +
    (args.recordCount >= 10 ? 2 : 0)

  const searchText = boundedSearchText([
    title,
    summaryText ?? '',
    args.view.firstPrompt,
    args.view.lastReply,
    ...args.view.files.map((file) => file.path),
    agent === 'claude' ? 'claude claude code' : 'codex codex cli',
  ])

  return {
    sid: args.sid,
    agent,
    title,
    summaryText,
    searchText,
    messageCount,
    toolCallCount,
    fileCount,
    additions: args.view.diffstat.adds,
    deletions: args.view.diffstat.dels,
    lineageSourceSid: parseLineageSourceSid(args.lineageJson),
    qualityScore,
    publishedAt: args.publishedAt,
    updatedAt: args.updatedAt,
  }
}

export function prepareDiscoveryProjectionUpsert(
  db: D1Database,
  projection: DiscoveryProjection,
): D1PreparedStatement {
  return db
    .prepare(
      '/* discovery:upsert-projection */ ' +
        'INSERT INTO hub_session_discovery ' +
        '(sid, agent, title, summary_text, search_text, message_count, tool_call_count, file_count, additions, deletions, lineage_source_sid, quality_score, published_at, updated_at) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(sid) DO UPDATE SET agent=excluded.agent, title=excluded.title, summary_text=excluded.summary_text, search_text=excluded.search_text, message_count=excluded.message_count, tool_call_count=excluded.tool_call_count, file_count=excluded.file_count, additions=excluded.additions, deletions=excluded.deletions, lineage_source_sid=excluded.lineage_source_sid, quality_score=excluded.quality_score, updated_at=excluded.updated_at',
    )
    .bind(
      projection.sid,
      projection.agent,
      projection.title,
      projection.summaryText,
      projection.searchText,
      projection.messageCount,
      projection.toolCallCount,
      projection.fileCount,
      projection.additions,
      projection.deletions,
      projection.lineageSourceSid,
      projection.qualityScore,
      projection.publishedAt,
      projection.updatedAt,
    )
}

function providerFromSid(sid: string): SessionProvider {
  if (!SID_RE.test(sid)) throw new ApiError('BAD_REQUEST', 'bad session id')
  const provider = sid.slice(0, sid.indexOf('_'))
  if (provider !== 'claude' && provider !== 'codex') {
    throw new ApiError('BAD_REQUEST', 'agent is not published to Discovery')
  }
  return provider
}

function fallbackTitle(agent: SessionProvider): string {
  return agent === 'claude' ? 'Claude Code session' : 'Codex CLI session'
}

function firstNonEmptyLine(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const collapsed = collapseWhitespace(line)
    if (collapsed) return collapsed
  }
  return ''
}

function firstMeaningfulSummaryLine(markdown: string | null): string {
  if (!markdown) return ''
  for (const line of markdown.split(/\r?\n/)) {
    const plain = markdownToPlainText(line)
    if (plain && !isGenericSummaryHeading(plain)) return plain
  }
  return ''
}

function isGenericSummaryHeading(value: string): boolean {
  return [
    'summary',
    'outcome',
    'overview',
    'result',
    'results',
    'changes',
    'what changed',
  ].includes(value.toLowerCase())
}

export function markdownToPlainText(markdown: string): string {
  return collapseWhitespace(
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>\n]*>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-+*]\s+|\d+[.)]\s+)/gm, '')
      .replace(/[*_~`]/g, ''),
  )
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function boundCharacters(value: string, maxCharacters: number): string {
  return Array.from(value).slice(0, maxCharacters).join('')
}

function boundedSearchText(parts: readonly string[]): string {
  let search = ''
  for (const part of parts) {
    const normalized = collapseWhitespace(part).toLowerCase()
    if (!normalized) continue
    const candidate = search ? `${search} ${normalized}` : normalized
    if (encoder.encode(candidate).byteLength > MAX_SEARCH_BYTES) {
      return truncateUtf8(candidate, MAX_SEARCH_BYTES)
    }
    search = candidate
  }
  return search
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (encoder.encode(value).byteLength <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (encoder.encode(value.slice(0, middle)).byteLength <= maxBytes) low = middle
    else high = middle - 1
  }
  if (low > 0) {
    const last = value.charCodeAt(low - 1)
    if (last >= 0xd800 && last <= 0xdbff) low -= 1
  }
  return value.slice(0, low)
}

function parseLineageSourceSid(lineageJson: string | null): string | null {
  if (!lineageJson) return null
  let value: unknown
  try {
    value = JSON.parse(lineageJson) as unknown
  } catch {
    return null
  }
  if (!isObject(value) || !isObject(value['source'])) return null
  const sid = value['source']['sid']
  return typeof sid === 'string' && SID_RE.test(sid) ? sid : null
}

function isSessionViewV1(value: unknown): value is SessionViewV1 {
  if (!isObject(value) || value['v'] !== 1) return false
  if (
    typeof value['firstPrompt'] !== 'string' ||
    typeof value['lastReply'] !== 'string' ||
    !Array.isArray(value['index']) ||
    !Array.isArray(value['files']) ||
    !Array.isArray(value['outline']) ||
    value['index'].length > MAX_VIEW_ENTRIES ||
    value['files'].length > MAX_VIEW_ENTRIES ||
    value['outline'].length > MAX_VIEW_ENTRIES
  ) {
    return false
  }
  if (!value['index'].every(isViewIndexEntry)) return false
  if (!value['files'].every(isViewFileEntry)) return false
  if (!value['outline'].every(isViewOutlineEntry)) return false
  return isDiffstat(value['diffstat'])
}

function isViewIndexEntry(value: unknown): boolean {
  if (!isObject(value)) return false
  const kind = value['kind']
  if (!isNonNegativeInteger(value['i']) || !isNonNegativeInteger(value['size'])) return false
  if (!['user', 'assistant', 'tool', 'edit', 'other'].includes(String(kind))) return false
  return ['ts', 'file', 'tool', 'excerpt'].every(
    (key) => value[key] === undefined || typeof value[key] === 'string',
  )
}

function isViewFileEntry(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value['path'] === 'string' &&
    Array.isArray(value['events']) &&
    value['events'].every(isNonNegativeInteger) &&
    isNonNegativeInteger(value['adds']) &&
    isNonNegativeInteger(value['dels'])
  )
}

function isViewOutlineEntry(value: unknown): boolean {
  return isObject(value) && isNonNegativeInteger(value['i']) && typeof value['excerpt'] === 'string'
}

function isDiffstat(value: unknown): boolean {
  return (
    isObject(value) &&
    isNonNegativeInteger(value['files']) &&
    isNonNegativeInteger(value['adds']) &&
    isNonNegativeInteger(value['dels'])
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

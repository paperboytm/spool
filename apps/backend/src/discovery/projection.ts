import type { D1Database, D1PreparedStatement, R2Bucket } from '@cloudflare/workers-types'
import {
  costForUsage,
  isDiscoverySessionProvider,
  parseSummaryFrontMatter,
  type SessionProvider,
  type SessionViewV1,
} from '@spool-lab/session-kit'

import { ApiError } from '../errors'
import { readObjects } from '../hub/packs'
import { locateObjects, locateTeamObjects } from '../hub/store'
import { SID_RE } from '../hub/wire'

const MAX_VIEW_BYTES = 8 * 1024 * 1024
const MAX_VIEW_ENTRIES = 100_000
const MAX_USAGE_MODELS = 1_000
const MAX_MODEL_ID_BYTES = 256
const MODEL_ID_RE = /^[^\s\u0000-\u001f\u007f]+$/u
const MAX_TITLE_CHARS = 200
const MAX_SUMMARY_CHARS = 4_000
const MAX_SEARCH_BYTES = 16 * 1024
const encoder = new TextEncoder()

export type DiscoveryProjection = {
  sid: string
  agent: SessionProvider
  title: string
  titleJson: string | null
  costUsd: number | null
  totalTokens: number | null
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

type ProjectionCost = {
  usd: number | null
  totalTokens: number
}

export async function readDiscoveryView(
  db: D1Database,
  bucket: R2Bucket,
  ownerUserId: string,
  viewOid: string,
  teamId: string | null = null,
): Promise<SessionViewV1> {
  const located = teamId
    ? await locateTeamObjects(db, teamId, [viewOid])
    : await locateObjects(db, ownerUserId, [viewOid])
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
  /** A head commit freezes pricing once. Later projection rebuilds must pass
   *  that persisted value instead of repricing the immutable view. */
  costOverride?: ProjectionCost | null
}): DiscoveryProjection {
  const agent = providerFromSid(args.sid)
  // The summary is stored verbatim (front-matter included) so shares
  // round-trip losslessly; the projection is where titles split out and the
  // plain-text body feeds excerpts and search.
  const { titles, body: summaryBody } = parseSummaryFrontMatter(args.summaryMd)
  const summaryTextValue = markdownToPlainText(summaryBody)
  const summaryText = summaryTextValue ? boundCharacters(summaryTextValue, MAX_SUMMARY_CHARS) : null
  const frontMatterTitle = titles?.en ?? titles?.zh ?? ''
  const promptTitle = firstNonEmptyLine(args.view.firstPrompt)
  const summaryTitle = firstMeaningfulSummaryLine(summaryBody)
  const contentTitle = frontMatterTitle || promptTitle || summaryTitle
  const title = boundCharacters(contentTitle || fallbackTitle(agent), MAX_TITLE_CHARS)
  const cost = args.costOverride === undefined ? costForUsage(args.view.usage) : args.costOverride
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
    titles?.zh ?? '',
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
    titleJson: titles ? JSON.stringify(titles) : null,
    costUsd: cost ? cost.usd : null,
    totalTokens: cost ? cost.totalTokens : null,
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
        '(sid, agent, title, summary_text, search_text, message_count, tool_call_count, file_count, additions, deletions, lineage_source_sid, quality_score, published_at, updated_at, title_json, cost_usd, total_tokens) ' +
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(sid) DO UPDATE SET agent=excluded.agent, title=excluded.title, summary_text=excluded.summary_text, search_text=excluded.search_text, message_count=excluded.message_count, tool_call_count=excluded.tool_call_count, file_count=excluded.file_count, additions=excluded.additions, deletions=excluded.deletions, lineage_source_sid=excluded.lineage_source_sid, quality_score=excluded.quality_score, updated_at=excluded.updated_at, title_json=excluded.title_json, cost_usd=excluded.cost_usd, total_tokens=excluded.total_tokens',
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
      projection.titleJson,
      projection.costUsd,
      projection.totalTokens,
    )
}

export type AuthorizedProjectionGate = {
  sid: string
  actorUserId: string
  teamId: string | null
  root: string
  updatedAt: number
  visibility: 'unlisted' | 'private'
  withdrawn: boolean
  requireAuthor: boolean
  requireTeamManager: boolean
}

const AUTHORIZED_SESSION_PROJECTION_GATE = `
  EXISTS (
    SELECT 1
    FROM hub_sessions gated_session
    WHERE gated_session.sid=?
      AND gated_session.root=?
      AND gated_session.updated_at=?
      AND gated_session.visibility=?
      AND (
        (?=1 AND gated_session.withdrawn_at IS NOT NULL)
        OR (?=0 AND gated_session.withdrawn_at IS NULL)
      )
      AND (?=0 OR gated_session.owner_user_id=?)
      AND (
        (? IS NULL AND gated_session.team_id IS NULL AND gated_session.owner_user_id=?)
        OR
        (gated_session.team_id=? AND EXISTS (
          SELECT 1
          FROM teams gated_team
          JOIN team_memberships gated_member ON gated_member.team_id=gated_team.id
          WHERE gated_team.id=? AND gated_team.archived_at IS NULL
            AND gated_team.deletion_pending_until IS NULL
            AND gated_member.user_id=?
            AND (?=0 OR gated_member.role IN ('owner','admin'))
        ))
      )
  )`

function authorizedProjectionGateValues(gate: AuthorizedProjectionGate): unknown[] {
  const withdrawn = gate.withdrawn ? 1 : 0
  return [
    gate.sid,
    gate.root,
    gate.updatedAt,
    gate.visibility,
    withdrawn,
    withdrawn,
    gate.requireAuthor ? 1 : 0,
    gate.actorUserId,
    gate.teamId,
    gate.actorUserId,
    gate.teamId,
    gate.teamId,
    gate.actorUserId,
    gate.requireTeamManager ? 1 : 0,
  ]
}

/** Projection writes share the same final authorization snapshot as their
 * Hub mutation. If Team authority changed before the D1 batch, both the head
 * write and this SELECT-gated upsert become no-ops. */
export function prepareAuthorizedDiscoveryProjectionUpsert(
  db: D1Database,
  projection: DiscoveryProjection,
  gate: AuthorizedProjectionGate,
): D1PreparedStatement {
  return db
    .prepare(
      `/* discovery:authorized-upsert-projection */
       INSERT INTO hub_session_discovery
         (sid, agent, title, summary_text, search_text, message_count,
          tool_call_count, file_count, additions, deletions,
          lineage_source_sid, quality_score, published_at, updated_at,
          title_json, cost_usd, total_tokens)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE ${AUTHORIZED_SESSION_PROJECTION_GATE}
       ON CONFLICT(sid) DO UPDATE SET
         agent=excluded.agent,
         title=excluded.title,
         summary_text=excluded.summary_text,
         search_text=excluded.search_text,
         message_count=excluded.message_count,
         tool_call_count=excluded.tool_call_count,
         file_count=excluded.file_count,
         additions=excluded.additions,
         deletions=excluded.deletions,
         lineage_source_sid=excluded.lineage_source_sid,
         quality_score=excluded.quality_score,
         updated_at=excluded.updated_at,
         title_json=excluded.title_json,
         cost_usd=excluded.cost_usd,
         total_tokens=excluded.total_tokens`,
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
      projection.titleJson,
      projection.costUsd,
      projection.totalTokens,
      ...authorizedProjectionGateValues(gate),
    )
}

export function prepareAuthorizedDiscoveryProjectionDelete(
  db: D1Database,
  gate: AuthorizedProjectionGate,
): D1PreparedStatement {
  return db
    .prepare(
      `/* discovery:authorized-delete-projection */
       DELETE FROM hub_session_discovery
       WHERE sid=? AND ${AUTHORIZED_SESSION_PROJECTION_GATE}`,
    )
    .bind(gate.sid, ...authorizedProjectionGateValues(gate))
}

export function prepareAuthorizedEngagementDelete(
  db: D1Database,
  gate: AuthorizedProjectionGate,
): D1PreparedStatement {
  return db
    .prepare(
      `/* discovery:authorized-delete-engagement */
       DELETE FROM hub_session_engagement_daily
       WHERE sid=? AND ${AUTHORIZED_SESSION_PROJECTION_GATE}`,
    )
    .bind(gate.sid, ...authorizedProjectionGateValues(gate))
}

export async function isPublishedToDiscovery(db: D1Database, sid: string): Promise<boolean> {
  const row = await db
    .prepare('/* discovery:is-published */ SELECT 1 FROM hub_session_discovery WHERE sid = ?')
    .bind(sid)
    .first()
  return row !== null
}

/** Public lineage may point only at another currently Public Session. This
 *  strips references to Team/Link-only sources before projection so a child
 *  cannot become an existence oracle for its private source. */
export async function filterPublicLineage(
  db: D1Database,
  lineageJson: string | null,
): Promise<string | null> {
  return filterLineageForAudience(db, lineageJson, null)
}

/** Preserve lineage only when the audience of the child Session may also
 * read its source. Public/Link-only children may reference only Public
 * sources; Team-only children may additionally reference a live source owned
 * by the same Team. This is applied both on write and on read so older rows
 * cannot disclose a private source id or URL after a visibility change. */
export async function filterLineageForAudience(
  db: D1Database,
  lineageJson: string | null,
  audienceTeamId: string | null,
): Promise<string | null> {
  if (!lineageJson) return null
  let sourceSid: string | null = null
  try {
    const parsed = JSON.parse(lineageJson) as { source?: { sid?: unknown } }
    sourceSid = typeof parsed.source?.sid === 'string' ? parsed.source.sid : null
  } catch {
    return null
  }
  if (!sourceSid || !SID_RE.test(sourceSid)) return null
  const source = await db
    .prepare(
      '/* discovery:lineage-source-audience */ ' +
        'SELECT s.team_id, s.visibility, s.withdrawn_at, ' +
        'CASE WHEN d.sid IS NULL THEN 0 ELSE 1 END AS published ' +
        'FROM hub_sessions s LEFT JOIN hub_session_discovery d ON d.sid=s.sid WHERE s.sid=?',
    )
    .bind(sourceSid)
    .first<{
      team_id: string | null
      visibility: string
      withdrawn_at: number | null
      published: number
    }>()
  if (!source || source.withdrawn_at !== null) return null
  const publicSource = source.visibility === 'unlisted' && source.published === 1
  const sameTeamSource = audienceTeamId !== null && source.team_id === audienceTeamId
  return publicSource || sameTeamSource ? lineageJson : null
}

function providerFromSid(sid: string): SessionProvider {
  if (!SID_RE.test(sid)) throw new ApiError('BAD_REQUEST', 'bad session id')
  const provider = sid.slice(0, sid.indexOf('_'))
  if (!isDiscoverySessionProvider(provider)) {
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
  if (value['usage'] !== undefined && !isSessionUsageV1(value['usage'])) return false
  return isDiffstat(value['diffstat'])
}

function isSessionUsageV1(value: unknown): boolean {
  if (!isObject(value) || !isObject(value['models'])) return false
  if (!isNonNegativeInteger(value['records']) || value['records'] > MAX_VIEW_ENTRIES) return false

  const models = Object.entries(value['models'])
  if (models.length > MAX_USAGE_MODELS) return false

  let totalTokens = 0
  for (const [modelId, totals] of models) {
    if (
      modelId.length === 0 ||
      modelId !== modelId.trim() ||
      encoder.encode(modelId).byteLength > MAX_MODEL_ID_BYTES ||
      !MODEL_ID_RE.test(modelId) ||
      !isObject(totals)
    ) {
      return false
    }
    for (const field of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
      const tokens = totals[field]
      if (!isNonNegativeInteger(tokens)) return false
      if (tokens > Number.MAX_SAFE_INTEGER - totalTokens) return false
      totalTokens += tokens
    }
  }
  return true
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

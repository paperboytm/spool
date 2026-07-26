import type { D1Database } from '@cloudflare/workers-types'
import {
  parseSummaryFrontMatter,
  type SessionSummaries,
  type SessionTitles,
} from '@spool-lab/session-kit'

import { base64urlFromBuffer, sha256 } from '../auth/pkce'
import { isPublishedToDiscovery } from '../discovery/projection'
import { ApiError } from '../errors'
import { getProjectById, projectOwner } from '../projects/store'
import type { ProjectRef } from '../projects/types'
import type { TeamRole } from './head'
import {
  isHydratedManagedSessionRow,
  managedSessionJoins,
  managedSessionProjection,
  type HydratedManagedSessionRow,
} from './managed-row'
import { getHubAuthor, type HubSessionRow } from './store'
import { SID_RE } from './wire'

const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100
const CURSOR_VERSION = 1

export type ManagedHubSessionPageOptions = {
  cursor: string | null
  limit: number
}

export type ManagedHubSessionPage = {
  sessions: ManagedHubSession[]
  /** Total Sessions in this scope, independent of the current page. */
  session_count: number
  next_cursor: string | null
}

type ManagedHubSessionPageKey = {
  updatedAt: number
  sid: string
}

type ManagedHubSessionScope =
  | { kind: 'owner'; actorUserId: string }
  | { kind: 'team'; actorUserId: string; teamId: string }

export type ManagedHubSession = {
  sid: string
  title: string
  /** Canonical bilingual task-outcome titles from Summary front-matter. */
  titles: SessionTitles | null
  summary: string | null
  /** Canonical bilingual Summary bodies; null for legacy single-language notes. */
  summaries: SessionSummaries | null
  /** Publish-time estimate from recorded token usage. */
  cost: { usd: number | null; totalTokens: number } | null
  /** Stars exist only while a Session is currently Public. */
  star_count: number
  provider: string
  created_at: number
  /** Discovery publication time. Null for Link-only and Team-only Sessions. */
  published_at: number | null
  updated_at: number
  visibility: 'public' | 'link-only' | 'team'
  team_id: string | null
  team_name: string | null
  project: ProjectRef
  can_manage_visibility: boolean
  author: {
    handle: string | null
    display_name: string | null
    avatar_url: string | null
  }
}

export async function listOwnerHubSessions(
  db: D1Database,
  userId: string,
  options: ManagedHubSessionPageOptions = {
    cursor: null,
    limit: DEFAULT_PAGE_LIMIT,
  },
): Promise<ManagedHubSessionPage> {
  const scope = { kind: 'owner' as const, actorUserId: userId }
  const fingerprint = await scopeFingerprint(scope)
  const after = decodeCursor(options.cursor, fingerprint)
  const rows = await db
    .prepare(
      `SELECT s.*, t.name AS team_name, m.role AS team_role,
         (
           SELECT COUNT(*)
           FROM hub_sessions counted
           LEFT JOIN teams counted_team ON counted_team.id=counted.team_id
           LEFT JOIN team_memberships counted_member
             ON counted_member.team_id=counted.team_id AND counted_member.user_id=actor.id
           WHERE counted.owner_user_id=actor.id AND counted.withdrawn_at IS NULL
             AND (
               counted.team_id IS NULL
               OR (
                 counted_member.user_id IS NOT NULL
                 AND counted_team.archived_at IS NULL
                 AND counted_team.deletion_pending_until IS NULL
               )
             )
         ) AS session_count,
         (SELECT COUNT(*) FROM hub_session_stars star WHERE star.sid=s.sid) AS star_count,
         ${managedSessionProjection()}
       FROM users actor
       JOIN hub_sessions s ON s.owner_user_id=actor.id
       ${managedSessionJoins('s')}
       LEFT JOIN teams t ON t.id=s.team_id
       LEFT JOIN team_memberships m ON m.team_id=s.team_id AND m.user_id=actor.id
       WHERE actor.id=? AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL AND s.withdrawn_at IS NULL
         AND (s.team_id IS NULL OR (m.user_id IS NOT NULL AND t.archived_at IS NULL
           AND t.deletion_pending_until IS NULL))
         AND (?=0 OR s.updated_at<? OR (s.updated_at=? AND s.sid>?))
       ORDER BY s.updated_at DESC, s.sid ASC LIMIT ?`,
    )
    .bind(
      userId,
      after === null ? 0 : 1,
      after?.updatedAt ?? 0,
      after?.updatedAt ?? 0,
      after?.sid ?? '',
      options.limit + 1,
    )
    .all<
      HydratedManagedSessionRow & {
        team_name: string | null
        team_role: string | null
        star_count: number
        session_count: number
      }
    >()
  const hasMore = rows.results.length > options.limit
  const pageRows = hasMore ? rows.results.slice(0, options.limit) : rows.results
  const sessions = await Promise.all(
    pageRows.map((row) =>
      serializeManagedSession(
        db,
        row,
        row.team_id === null || row.team_role === 'owner' || row.team_role === 'admin',
      ),
    ),
  )
  return {
    sessions,
    session_count: Math.max(0, Number(rows.results[0]?.session_count ?? rows.results.length)),
    next_cursor: hasMore ? encodeCursor(pageKey(pageRows.at(-1)!), fingerprint) : null,
  }
}

export async function listTeamHubSessions(
  db: D1Database,
  teamId: string,
  actorUserId: string,
  options: ManagedHubSessionPageOptions = {
    cursor: null,
    limit: DEFAULT_PAGE_LIMIT,
  },
): Promise<ManagedHubSessionPage | null> {
  const scope = { kind: 'team' as const, actorUserId, teamId }
  const fingerprint = await scopeFingerprint(scope)
  const after = decodeCursor(options.cursor, fingerprint)
  const rows = await db
    .prepare(
      `/* hub:list-team-sessions-authorized */
       WITH current_team AS (
         SELECT t.id, t.name, m.role
         FROM teams t
         JOIN team_memberships m ON m.team_id=t.id
         JOIN users actor ON actor.id=m.user_id
         WHERE t.id=? AND m.user_id=?
           AND t.archived_at IS NULL
           AND t.deletion_pending_until IS NULL
           AND actor.deleted_at IS NULL
           AND actor.deletion_pending_until IS NULL
       )
       SELECT s.*, current_team.name AS team_name, current_team.role AS team_role,
         (
           SELECT COUNT(*)
           FROM hub_sessions counted
           WHERE counted.team_id=current_team.id AND counted.withdrawn_at IS NULL
         ) AS session_count,
         (SELECT COUNT(*) FROM hub_session_stars star WHERE star.sid=s.sid) AS star_count,
         ${managedSessionProjection()}
       FROM current_team
       LEFT JOIN hub_sessions s
         ON s.team_id=current_team.id AND s.withdrawn_at IS NULL
         AND (?=0 OR s.updated_at<? OR (s.updated_at=? AND s.sid>?))
       ${managedSessionJoins('s', true)}
       ORDER BY s.updated_at DESC, s.sid ASC
       LIMIT ?`,
    )
    .bind(
      teamId,
      actorUserId,
      after === null ? 0 : 1,
      after?.updatedAt ?? 0,
      after?.updatedAt ?? 0,
      after?.sid ?? '',
      options.limit + 1,
    )
    .all<
      { [K in keyof HydratedManagedSessionRow]: HydratedManagedSessionRow[K] | null } & {
        team_name: string
        team_role: TeamRole
        star_count: number
        session_count: number
      }
    >()
  if (rows.results.length === 0) return null

  const sessionRows = rows.results.filter((row) => row.sid !== null)
  const hasMore = sessionRows.length > options.limit
  const pageRows = hasMore ? sessionRows.slice(0, options.limit) : sessionRows
  const sessions = await Promise.all(
    pageRows.map((row) =>
      serializeManagedSession(
        db,
        row as HydratedManagedSessionRow & { team_name: string },
        row.team_role === 'owner' || row.team_role === 'admin',
      ),
    ),
  )
  return {
    sessions,
    session_count: Math.max(0, Number(rows.results[0]?.session_count ?? sessionRows.length)),
    next_cursor: hasMore
      ? encodeCursor(pageKey(pageRows.at(-1)! as HubSessionRow), fingerprint)
      : null,
  }
}

export function parseManagedHubSessionPageOptions(request: Request): ManagedHubSessionPageOptions {
  const url = new URL(request.url)
  rejectDuplicate(url, 'cursor')
  rejectDuplicate(url, 'limit')

  const cursor = url.searchParams.get('cursor')
  const limitValue = url.searchParams.get('limit')
  if (limitValue === null) return { cursor, limit: DEFAULT_PAGE_LIMIT }
  if (!/^\d+$/.test(limitValue)) {
    throw new ApiError('BAD_REQUEST', `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`)
  }
  const limit = Number(limitValue)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ApiError('BAD_REQUEST', `limit must be an integer from 1 to ${MAX_PAGE_LIMIT}`)
  }
  return { cursor, limit }
}

function rejectDuplicate(url: URL, name: string): void {
  if (url.searchParams.getAll(name).length > 1) {
    throw new ApiError('BAD_REQUEST', `${name} must be provided at most once`)
  }
}

async function scopeFingerprint(scope: ManagedHubSessionScope): Promise<string> {
  const key =
    scope.kind === 'owner'
      ? [scope.kind, scope.actorUserId]
      : [scope.kind, scope.actorUserId, scope.teamId]
  return base64urlFromBuffer(await sha256(JSON.stringify(key))).slice(0, 16)
}

function encodeCursor(key: ManagedHubSessionPageKey, fingerprint: string): string {
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      v: CURSOR_VERSION,
      f: fingerprint,
      u: key.updatedAt,
      i: key.sid,
    }),
  )
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return base64urlFromBuffer(buffer)
}

function pageKey(row: Pick<HubSessionRow, 'updated_at' | 'sid'>): ManagedHubSessionPageKey {
  return { updatedAt: row.updated_at, sid: row.sid }
}

function decodeCursor(
  value: string | null,
  expectedFingerprint: string,
): ManagedHubSessionPageKey | null {
  if (value === null) return null
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
    !isNonNegativeSafeInteger(decoded['u']) ||
    typeof decoded['i'] !== 'string' ||
    !SID_RE.test(decoded['i'])
  ) {
    throw new ApiError('BAD_REQUEST', 'malformed or mismatched cursor')
  }
  return { updatedAt: decoded['u'], sid: decoded['i'] }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export async function serializeManagedSession(
  db: D1Database,
  row:
    | (HubSessionRow & { team_name?: string | null; star_count?: number })
    | HydratedManagedSessionRow,
  canManageVisibility = true,
): Promise<ManagedHubSession> {
  const hydrated = isHydratedManagedSessionRow(row)
  const fallback = hydrated
    ? null
    : await Promise.all([
        getHubAuthor(db, row.owner_user_id),
        row.visibility === 'unlisted'
          ? isPublishedToDiscovery(db, row.sid)
          : Promise.resolve(false),
        row.star_count === undefined
          ? sessionStarCount(db, row.sid)
          : Promise.resolve(row.star_count),
        getProjectById(db, row.project_id, { includeArchived: true }),
      ])
  const fallbackProject = fallback?.[3] ?? null
  if (!hydrated && !fallbackProject) throw new ApiError('INTERNAL', 'Session Project missing')
  const author = hydrated
    ? {
        handle: row.managed_author_handle,
        displayName: row.managed_author_display_name ?? row.managed_author_name,
        avatarUrl: visibleAvatarUrl({
          userId: row.owner_user_id,
          avatarUrl: row.managed_author_avatar_url,
          customAvatarId: row.managed_author_custom_avatar_id,
          avatarVisible: row.managed_author_avatar_visible,
        }),
      }
    : fallback![0]
  const published = hydrated ? row.managed_published === 1 : fallback![1]
  const starCount = hydrated ? (row.star_count ?? 0) : fallback![2]
  const project: ProjectRef = hydrated
    ? {
        id: row.project_id,
        slug: row.managed_project_slug,
        name: row.managed_project_name,
        owner: {
          kind: row.managed_project_owner_team_id === null ? 'user' : 'team',
          id:
            row.managed_project_owner_team_id ??
            row.managed_project_owner_user_id ??
            row.owner_user_id,
          handle: row.managed_project_owner_handle,
          name: row.managed_project_owner_name,
          avatar_url:
            row.managed_project_owner_user_id === null
              ? null
              : visibleAvatarUrl({
                  userId: row.managed_project_owner_user_id,
                  avatarUrl: row.managed_project_owner_avatar_url,
                  customAvatarId: row.managed_project_owner_custom_avatar_id,
                  avatarVisible: row.managed_project_owner_avatar_visible,
                }),
        },
      }
    : {
        id: fallbackProject!.id,
        slug: fallbackProject!.slug,
        name: fallbackProject!.name,
        owner: await projectOwner(db, fallbackProject!),
      }
  const parsedSummary = parseSummaryFrontMatter(row.note_md)
  return {
    sid: row.sid,
    title: sessionTitle(row, parsedSummary.titles),
    titles: parsedSummary.titles,
    summary: row.note_md === null ? null : parsedSummary.body,
    summaries: parsedSummary.summaries ?? null,
    cost:
      row.total_tokens !== null && row.total_tokens > 0
        ? { usd: row.cost_usd, totalTokens: row.total_tokens }
        : null,
    star_count: Math.max(0, Number(starCount)),
    provider: row.sid.slice(0, row.sid.indexOf('_')),
    created_at: row.created_at,
    published_at: hydrated ? row.managed_published_at : published ? row.created_at : null,
    updated_at: row.updated_at,
    visibility:
      row.visibility === 'private' && row.team_id ? 'team' : published ? 'public' : 'link-only',
    team_id: row.team_id ?? null,
    team_name: row.team_name ?? null,
    project,
    can_manage_visibility: canManageVisibility,
    author: {
      handle: author.handle,
      display_name: author.displayName,
      avatar_url: author.avatarUrl,
    },
  }
}

function visibleAvatarUrl(args: {
  userId: string
  avatarUrl: string | null
  customAvatarId: string | null
  avatarVisible: number
}): string | null {
  if (args.avatarVisible !== 1) return null
  return args.customAvatarId
    ? `/api/avatars/${encodeURIComponent(args.userId)}?v=${encodeURIComponent(args.customAvatarId)}`
    : args.avatarUrl
}

async function sessionStarCount(db: D1Database, sid: string): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS star_count FROM hub_session_stars WHERE sid=?')
    .bind(sid)
    .first<{ star_count: number }>()
  return Number(row?.star_count ?? 0)
}

function sessionTitle(
  row: Pick<HubSessionRow, 'sid' | 'card_json' | 'note_md'>,
  titles: SessionTitles | null,
): string {
  // The agent-authored task title outranks workspace naming: it says what
  // the Session accomplished rather than where it ran.
  const taskTitle = titles?.en ?? titles?.zh
  if (taskTitle) return taskTitle.slice(0, 200)
  if (row.card_json) {
    try {
      const card = JSON.parse(row.card_json) as { title?: unknown; workspace?: unknown }
      if (typeof card.title === 'string' && card.title.trim())
        return card.title.trim().slice(0, 200)
      if (typeof card.workspace === 'string' && card.workspace.trim()) {
        return card.workspace.trim().slice(0, 200)
      }
    } catch {
      // Fall through to authored Summary/provider fallback.
    }
  }
  if (row.note_md) {
    for (const line of row.note_md.split(/\r?\n/)) {
      const plain = line.replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-+*]\s+)/, '').trim()
      if (plain && !['summary', 'outcome', 'overview'].includes(plain.toLowerCase())) {
        return plain.slice(0, 200)
      }
    }
  }
  const provider = row.sid.slice(0, row.sid.indexOf('_'))
  return `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex CLI' : provider} session`
}

import type Database from 'better-sqlite3'

import { SESSION_SELECT, rowToSession } from '../db/queries.js'
import type { Session, SessionSource } from '../types.js'

export type ProjectSessionSortOrder = 'recent' | 'oldest' | 'most_messages' | 'title'

export type SessionsCursor = {
  startedAt: string
  sessionUuid: string
  messageCount: number
  title: string
}

export type SessionsPage = {
  sessions: Session[]
  nextCursor: SessionsCursor | null
}

export interface ListSessionsByIdentityOptions {
  sources?: SessionSource[]
  sortOrder?: ProjectSessionSortOrder
  limit?: number
  excludePinned?: boolean
  cursor?: SessionsCursor
}

const DEFAULT_PAGE_SIZE = 50

export function listSessionsByIdentity(
  db: Database.Database,
  identityKey: string,
  options: ListSessionsByIdentityOptions = {},
): SessionsPage {
  const {
    sources,
    sortOrder = 'recent',
    limit = DEFAULT_PAGE_SIZE,
    excludePinned = false,
    cursor,
  } = options

  const conditions: string[] = ['p.identity_key = ?', 's.message_count > 0']
  const params: unknown[] = [identityKey]

  if (sources && sources.length > 0) {
    const placeholders = sources.map(() => '?').join(',')
    conditions.push(`src.name IN (${placeholders})`)
    params.push(...sources)
  }

  if (excludePinned) {
    conditions.push('NOT EXISTS (SELECT 1 FROM pins WHERE pins.session_uuid = s.session_uuid)')
  }

  if (cursor) {
    const c = cursorWhere(sortOrder, cursor)
    conditions.push(c.sql)
    params.push(...c.params)
  }

  return executePage(db, conditions, params, sortOrder, limit)
}

export function listRecentSessionsPage(
  db: Database.Database,
  options: { limit?: number; cursor?: SessionsCursor } = {},
): SessionsPage {
  const { limit = DEFAULT_PAGE_SIZE, cursor } = options
  const conditions: string[] = [
    's.message_count > 0',
    `(s.parent_session_uuid IS NULL OR NOT EXISTS (
      SELECT 1 FROM sessions parent
      WHERE parent.session_uuid = s.parent_session_uuid
        AND parent.message_count > 0
    ))`,
  ]
  const params: unknown[] = []
  if (cursor) {
    const c = cursorWhere('recent', cursor)
    conditions.push(c.sql)
    params.push(...c.params)
  }
  return executeRecentTreePage(db, conditions, params, limit)
}

export type DirectoryCount = {
  cwd: string
  sessionCount: number
  lastSessionAt: string
}

/**
 * Per-cwd counts across the full project. Drives the chip strip's badges
 * so they show the true distribution rather than just the loaded page.
 * Honors the same `sources` filter as `listSessionsByIdentity`.
 */
export function listProjectDirectoryCounts(
  db: Database.Database,
  identityKey: string,
  options: { sources?: SessionSource[] } = {},
): DirectoryCount[] {
  const { sources } = options
  const conditions: string[] = ['p.identity_key = ?', 's.message_count > 0']
  const params: unknown[] = [identityKey]
  if (sources && sources.length > 0) {
    const placeholders = sources.map(() => '?').join(',')
    conditions.push(`src.name IN (${placeholders})`)
    params.push(...sources)
  }
  const sql = `
    SELECT
      COALESCE(NULLIF(s.cwd, ''), '(unknown)') AS cwd,
      COUNT(*) AS cnt,
      MAX(s.started_at) AS last_at
    FROM sessions s
    JOIN sources src ON src.id = s.source_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${conditions.join(' AND ')}
    GROUP BY cwd
    ORDER BY MAX(s.started_at) DESC
  `
  const rows = db.prepare(sql).all(...params) as Array<{
    cwd: string
    cnt: number
    last_at: string
  }>
  return rows.map((r) => ({ cwd: r.cwd, sessionCount: r.cnt, lastSessionAt: r.last_at }))
}

export function listPinnedSessionsByIdentity(
  db: Database.Database,
  identityKey: string,
): Session[] {
  const rows = db
    .prepare(`
    ${SESSION_SELECT}
    JOIN pins ON pins.session_uuid = s.session_uuid
    WHERE p.identity_key = ? AND s.message_count > 0
    ORDER BY pins.pinned_at DESC
  `)
    .all(identityKey) as Array<Record<string, unknown>>
  return rows.map(rowToSession)
}

function executePage(
  db: Database.Database,
  conditions: string[],
  params: unknown[],
  sortOrder: ProjectSessionSortOrder,
  limit: number,
): SessionsPage {
  const sql = `
    ${SESSION_SELECT}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderByClause(sortOrder)}
    LIMIT ?
  `
  // Fetch limit+1 so we can detect "more rows exist" without a count query.
  const rows = db.prepare(sql).all(...params, limit + 1) as Array<Record<string, unknown>>
  const hasMore = rows.length > limit
  const pageRows = hasMore ? rows.slice(0, limit) : rows
  const sessions = pageRows.map(rowToSession)
  const last = sessions.at(-1)
  const nextCursor =
    hasMore && last
      ? {
          startedAt: last.startedAt,
          sessionUuid: last.sessionUuid,
          messageCount: last.messageCount,
          title: last.title ?? '',
        }
      : null
  return { sessions, nextCursor }
}

function executeRecentTreePage(
  db: Database.Database,
  conditions: string[],
  params: unknown[],
  limit: number,
): SessionsPage {
  const rows = db
    .prepare(`
    ${SESSION_SELECT}
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${orderByClause('recent')}
    LIMIT ?
  `)
    .all(...params, limit + 1) as Array<Record<string, unknown>>

  const hasMore = rows.length > limit
  const rootRows = hasMore ? rows.slice(0, limit) : rows
  const roots = rootRows.map(rowToSession)
  const lastRoot = roots.at(-1)
  const nextCursor =
    hasMore && lastRoot
      ? {
          startedAt: lastRoot.startedAt,
          sessionUuid: lastRoot.sessionUuid,
          messageCount: lastRoot.messageCount,
          title: lastRoot.title ?? '',
        }
      : null

  if (roots.length === 0) return { sessions: [], nextCursor }

  const placeholders = roots.map(() => '?').join(',')
  const descendants = db
    .prepare(`
    WITH RECURSIVE descendant_ids(session_uuid) AS (
      SELECT child.session_uuid
      FROM sessions child
      WHERE child.parent_session_uuid IN (${placeholders})
      UNION
      SELECT child.session_uuid
      FROM sessions child
      JOIN descendant_ids parent ON child.parent_session_uuid = parent.session_uuid
    )
    ${SESSION_SELECT}
    WHERE s.session_uuid IN (SELECT session_uuid FROM descendant_ids)
      AND s.message_count > 0
    ORDER BY s.started_at ASC, s.session_uuid ASC
  `)
    .all(...roots.map((root) => root.sessionUuid)) as Array<Record<string, unknown>>

  return {
    sessions: [...roots, ...descendants.map(rowToSession)],
    nextCursor,
  }
}

function orderByClause(sortOrder: ProjectSessionSortOrder): string {
  // session_uuid is the unique tiebreaker so the page boundary is deterministic
  // and keyset pagination skips exactly the rows already shown.
  switch (sortOrder) {
    case 'oldest':
      return 's.started_at ASC, s.session_uuid ASC'
    case 'most_messages':
      return 's.message_count DESC, s.started_at DESC, s.session_uuid ASC'
    case 'title':
      return "COALESCE(NULLIF(s.title, ''), '') ASC, s.started_at DESC, s.session_uuid ASC"
    case 'recent':
    default:
      return 's.started_at DESC, s.session_uuid ASC'
  }
}

function cursorWhere(
  sortOrder: ProjectSessionSortOrder,
  c: SessionsCursor,
): { sql: string; params: unknown[] } {
  const titleExpr = "COALESCE(NULLIF(s.title, ''), '')"
  switch (sortOrder) {
    case 'oldest':
      return {
        sql: '(s.started_at > ? OR (s.started_at = ? AND s.session_uuid > ?))',
        params: [c.startedAt, c.startedAt, c.sessionUuid],
      }
    case 'most_messages':
      return {
        sql: `(
          s.message_count < ?
          OR (s.message_count = ? AND s.started_at < ?)
          OR (s.message_count = ? AND s.started_at = ? AND s.session_uuid > ?)
        )`,
        params: [
          c.messageCount,
          c.messageCount,
          c.startedAt,
          c.messageCount,
          c.startedAt,
          c.sessionUuid,
        ],
      }
    case 'title':
      return {
        sql: `(
          ${titleExpr} > ?
          OR (${titleExpr} = ? AND s.started_at < ?)
          OR (${titleExpr} = ? AND s.started_at = ? AND s.session_uuid > ?)
        )`,
        params: [c.title, c.title, c.startedAt, c.title, c.startedAt, c.sessionUuid],
      }
    case 'recent':
    default:
      return {
        sql: '(s.started_at < ? OR (s.started_at = ? AND s.session_uuid > ?))',
        params: [c.startedAt, c.startedAt, c.sessionUuid],
      }
  }
}

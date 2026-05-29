import type Database from 'better-sqlite3'
import type { Session, Message, FragmentResult, StatusInfo, SearchMatchType, SessionSource, ProjectIdentityKind } from '../types.js'
import { DB_PATH, getDBSize } from './db.js'
import { buildSearchPlan, canUseSessionSearchFts, getNaturalSearchPhrase, getNaturalSearchTerms, selectFtsTableKind, shouldUseSessionFallback } from './search-query.js'

export function getOrCreateProject(
  db: Database.Database,
  sourceId: number,
  slug: string,
  displayPath: string,
  displayName: string,
  identity: { identityKind: ProjectIdentityKind; identityKey: string },
): number {
  const existing = db
    .prepare('SELECT id FROM projects WHERE source_id = ? AND slug = ?')
    .get(sourceId, slug) as { id: number } | undefined

  if (existing) return existing.id

  const result = db
    .prepare(
      'INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(sourceId, slug, displayPath, displayName, identity.identityKind, identity.identityKey)

  return Number(result.lastInsertRowid)
}

export function getSourceId(db: Database.Database, name: SessionSource): number {
  const row = db.prepare('SELECT id FROM sources WHERE name = ?').get(name) as
    | { id: number }
    | undefined
  if (!row) throw new Error(`Source '${name}' not found in DB`)
  return row.id
}

/**
 * Get/create the virtual "Asks" project that holds Spool-authored agent-search
 * sessions. One per source so each agent's sessions stay grouped under their
 * own row in project_groups_v (joined by identity for cross-source grouping).
 */
export function getOrCreateAskProject(db: Database.Database, source: SessionSource): number {
  const sourceId = getSourceId(db, source)
  return getOrCreateProject(
    db, sourceId,
    '__spool_ask__',
    '<spool:ask>',
    'Asks',
    { identityKind: 'spool_internal', identityKey: 'ask' },
  )
}

/**
 * Insert a session row authored by Spool itself (e.g. agent search). Title is
 * locked via title_source='spool' so subsequent sync of the source-side
 * session record won't overwrite it. file_path uses a sentinel
 * ('spool:pending:<uuid>') that upsertSession rebinds to the real path when
 * sync first sees the persisted source session.
 *
 * Idempotent: if a row with the same session_uuid already exists, returns its
 * id without modifying anything.
 */
export function insertSpoolAuthoredSession(
  db: Database.Database,
  opts: {
    projectId: number
    sourceId: number
    sessionUuid: string
    title: string
    cwd: string
  },
): number {
  const existing = db.prepare('SELECT id FROM sessions WHERE session_uuid = ?')
    .get(opts.sessionUuid) as { id: number } | undefined
  if (existing) return existing.id

  const now = new Date().toISOString()
  const sentinel = `spool:pending:${opts.sessionUuid}`
  const result = db.prepare(`
    INSERT INTO sessions
      (project_id, source_id, session_uuid, file_path, title, title_source,
       started_at, ended_at, message_count, has_tool_use, cwd, model, raw_file_mtime)
    VALUES (?, ?, ?, ?, ?, 'spool', ?, ?, 0, 0, ?, '', '')
  `).run(
    opts.projectId, opts.sourceId, opts.sessionUuid, sentinel, opts.title,
    now, now, opts.cwd,
  )
  return Number(result.lastInsertRowid)
}

export function getSessionMtime(db: Database.Database, filePath: string): string | null {
  const row = db
    .prepare('SELECT raw_file_mtime FROM sessions WHERE file_path = ?')
    .get(filePath) as { raw_file_mtime: string | null } | undefined
  return row?.raw_file_mtime ?? null
}

export function deleteSessionByFilePath(db: Database.Database, filePath: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE file_path = ?').run(filePath)
  return result.changes > 0
}

export function getAllSessionMtimes(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare('SELECT file_path, raw_file_mtime FROM sessions')
    .all() as Array<{ file_path: string; raw_file_mtime: string }>
  return new Map(rows.map(r => [r.file_path, r.raw_file_mtime]))
}

/** Sync mode for {@link upsertSession}.
 *
 *  - `rewrite`: today's behaviour. When the session already exists,
 *    DELETE all its messages so the caller's {@link insertMessages}
 *    can fully repopulate from the parsed source. Used for first
 *    syncs, source-rewrite recoveries, and the explicit "Refresh from
 *    source" action.
 *  - `append`: skip the DELETE. The caller's {@link insertMessages}
 *    will INSERT OR IGNORE against the partial UNIQUE index on
 *    (session_id, msg_uuid), so existing rows survive and any
 *    user-side state attached to them (Security Scan purge/dismiss,
 *    star, etc.) persists across the re-sync — the root-cause fix for
 *    "purge gets undone by re-sync". */
export type UpsertSessionMode = 'rewrite' | 'append'

export function upsertSession(
  db: Database.Database,
  opts: {
    projectId: number
    sourceId: number
    sessionUuid: string
    filePath: string
    title: string
    startedAt: string
    endedAt: string
    messageCount: number
    hasToolUse: boolean
    cwd: string
    model: string
    rawFileMtime: string
  },
  mode: UpsertSessionMode = 'rewrite',
): number {
  const existing = db
    .prepare('SELECT id, file_path FROM sessions WHERE session_uuid = ?')
    .get(opts.sessionUuid) as { id: number; file_path: string } | undefined

  if (existing) {
    // Warn loudly if two files claim the same session_uuid. The 'spool:pending:'
    // sentinel rebinding is legitimate (Spool-authored sessions); anything else
    // means we're about to silently overwrite a session row — historically this
    // happened when subagent jsonls under <slug>/<uuid>/subagents/ got indexed
    // and clobbered the parent row.
    if (
      existing.file_path !== opts.filePath
      && !existing.file_path.startsWith('spool:pending:')
    ) {
      console.warn(
        `[upsertSession] session_uuid ${opts.sessionUuid} switching file_path: `
        + `${existing.file_path} → ${opts.filePath}`,
      )
    }
    if (mode === 'rewrite') {
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(existing.id)
    }
    // file_path is updated too: Spool-authored sessions start with a sentinel
    // ('spool:pending:<uuid>') and get rebound to the real source path here on
    // first sync. For normal sessions this is a no-op (same path).
    //
    // `message_count` is intentionally NOT updated here — the syncer
    // recomputes it from the actual DB row count after insertMessages
    // returns, which is the only count consistent with INSERT OR
    // IGNORE-driven dedupe (claude tool-use shadow records would
    // otherwise inflate the parser-derived value back to pre-v14
    // levels on every sync).
    db.prepare(`
      UPDATE sessions SET
        title = CASE WHEN title_source = 'derived' THEN ? ELSE title END,
        file_path = ?,
        started_at = ?, ended_at = ?,
        has_tool_use = ?, cwd = ?, model = ?, raw_file_mtime = ?
      WHERE id = ?
    `).run(
      opts.title, opts.filePath, opts.startedAt, opts.endedAt,
      opts.hasToolUse ? 1 : 0, opts.cwd, opts.model, opts.rawFileMtime,
      existing.id,
    )
    return existing.id
  }

  const result = db.prepare(`
    INSERT INTO sessions
      (project_id, source_id, session_uuid, file_path, title,
       started_at, ended_at, message_count, has_tool_use, cwd, model, raw_file_mtime)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.projectId, opts.sourceId, opts.sessionUuid, opts.filePath, opts.title,
    opts.startedAt, opts.endedAt, opts.messageCount, opts.hasToolUse ? 1 : 0,
    opts.cwd, opts.model, opts.rawFileMtime,
  )

  return Number(result.lastInsertRowid)
}

export function upsertSessionSearch(
  db: Database.Database,
  opts: {
    sessionId: number
    title: string
    userText: string
    assistantText: string
  },
): void {
  db.prepare(`
    INSERT INTO session_search (session_id, title, user_text, assistant_text, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id) DO UPDATE SET
      title = excluded.title,
      user_text = excluded.user_text,
      assistant_text = excluded.assistant_text,
      updated_at = datetime('now')
  `).run(
    opts.sessionId,
    opts.title,
    opts.userText,
    opts.assistantText,
  )
}

/** Insert message rows, skipping any that collide with the partial
 *  UNIQUE index on (session_id, msg_uuid). Returns the count of rows
 *  actually inserted — callers use this to decide whether anything
 *  changed (NULL scan_profile, fire onSessionChanged) or to skip
 *  downstream work when re-sync was a no-op.
 *
 *  The ON CONFLICT clause must restate the same `WHERE msg_uuid IS
 *  NOT NULL` predicate as the index it targets; SQLite requires the
 *  predicates to match before it considers a partial index for
 *  conflict resolution. */
export function insertMessages(
  db: Database.Database,
  sessionId: number,
  sourceId: number,
  messages: Array<{
    uuid: string
    parentUuid: string | null
    role: string
    contentText: string
    timestamp: string
    isSidechain: boolean
    toolNames: string[]
    seq: number
  }>,
): number {
  const stmt = db.prepare(`
    INSERT INTO messages
      (session_id, source_id, msg_uuid, parent_uuid, role,
       content_text, timestamp, is_sidechain, tool_names, seq)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, msg_uuid) WHERE msg_uuid IS NOT NULL DO NOTHING
  `)

  let inserted = 0
  for (const m of messages) {
    const info = stmt.run(
      sessionId, sourceId, m.uuid, m.parentUuid, m.role,
      m.contentText, m.timestamp, m.isSidechain ? 1 : 0,
      JSON.stringify(m.toolNames), m.seq,
    )
    if (info.changes > 0) inserted++
  }
  return inserted
}

/** Lightweight snapshot used by the syncer's `classifySync` heuristic
 *  to decide between append and rewrite paths — just the row count
 *  and the leading uuid in seq order, joined off `session_uuid` so the
 *  caller doesn't pay a second `SELECT id FROM sessions` round-trip
 *  (upsertSession does that lookup anyway right after).
 *
 *  We deliberately do NOT pull `content_text` here: comparing parsed-
 *  vs-stored content would trigger rewrite whenever Security Scan has
 *  already replaced the raw value with its mask, undoing the purge on
 *  every re-sync. Only msg_uuid-bearing rows participate in the dedupe
 *  index, so NULL-uuid rows are excluded.
 *
 *  Returns `total === 0, firstUuid === null` both for "session row
 *  doesn't exist yet" and "session exists with no msg_uuid-bearing
 *  rows" — classifySync treats both as `rewrite` so the two-state
 *  collapse is intentional, not a lost signal. */
export function getMessageSnapshot(
  db: Database.Database,
  sessionUuid: string,
): { firstUuid: string | null; total: number } {
  // Single window-function query: pulls total and leading uuid in one
  // index scan over (session_id, msg_uuid). `LIMIT 1` returns the
  // smallest-seq row; `COUNT(*) OVER ()` annotates it with the total
  // across the windowed partition (no GROUP BY needed since the
  // WHERE already scopes to one session).
  const row = db.prepare(
    `SELECT m.msg_uuid AS msg_uuid, COUNT(*) OVER () AS total
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
      WHERE s.session_uuid = ? AND m.msg_uuid IS NOT NULL
      ORDER BY m.seq, m.id LIMIT 1`,
  ).get(sessionUuid) as { msg_uuid: string; total: number } | undefined
  if (!row) return { firstUuid: null, total: 0 }
  return { firstUuid: row.msg_uuid, total: row.total }
}

/** Refresh `sessions.message_count` for a single session from the
 *  actual non-sidechain row count. Called after every sync's INSERT
 *  block so the denormalised count tracks the deduped truth — the
 *  parser's `parsed.messages.length` would re-introduce the v14-fixed
 *  inflation for source formats (claude) that emit some records
 *  twice. */
export function recomputeMessageCount(
  db: Database.Database,
  sessionId: number,
): void {
  db.prepare(
    `UPDATE sessions SET message_count = (
        SELECT COUNT(*) FROM messages
         WHERE session_id = sessions.id AND is_sidechain = 0
      ) WHERE id = ?`,
  ).run(sessionId)
}

export const SESSION_SELECT = `
  SELECT
    s.id, s.project_id AS projectId, s.source_id AS sourceId,
    s.session_uuid AS sessionUuid, s.file_path AS filePath,
    s.title, s.started_at AS startedAt, s.ended_at AS endedAt,
    s.message_count AS messageCount, s.has_tool_use AS hasToolUse,
    s.cwd, s.model,
    s.scan_finding_count AS scanFindingCount,
    s.scan_high_count    AS scanHighCount,
    s.scan_purged_count  AS scanPurgedCount,
    s.scan_completed_at  AS scanCompletedAt,
    src.name AS source,
    p.display_path AS projectDisplayPath,
    p.display_name AS projectDisplayName
  FROM sessions s
  JOIN sources src ON src.id = s.source_id
  JOIN projects p ON p.id = s.project_id`


export function getSessionWithMessages(
  db: Database.Database,
  sessionUuid: string,
): { session: Session; messages: Message[] } | null {
  const sessionRow = db.prepare(`
    ${SESSION_SELECT}
    WHERE s.session_uuid = ?
  `).get(sessionUuid) as Record<string, unknown> | undefined

  if (!sessionRow) return null

  const session = rowToSession(sessionRow)
  const msgRows = db.prepare(`
    SELECT id, session_id AS sessionId, msg_uuid AS msgUuid,
           parent_uuid AS parentUuid, role, content_text AS contentText,
           timestamp, is_sidechain AS isSidechain, tool_names AS toolNames, seq
    FROM messages
    WHERE session_id = ?
      AND (is_sidechain = 0 OR parent_uuid LIKE 'opencode-subagent:%')
    ORDER BY seq
  `).all(session.id) as Array<Record<string, unknown>>

  const messages: Message[] = msgRows.map(r => ({
    id: r['id'] as number,
    sessionId: r['sessionId'] as number,
    msgUuid: r['msgUuid'] as string | null,
    parentUuid: r['parentUuid'] as string | null,
    role: r['role'] as 'user' | 'assistant' | 'system',
    contentText: r['contentText'] as string,
    timestamp: r['timestamp'] as string,
    isSidechain: Boolean(r['isSidechain']),
    toolNames: JSON.parse(r['toolNames'] as string) as string[],
    seq: r['seq'] as number,
  }))

  return { session, messages }
}

export function searchFragments(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): FragmentResult[] {
  const { limit = 10, source, since, onlyPinned, identityKey } = opts

  const rowLimit = Math.max(limit * 10, 50)
  const naturalTerms = getNaturalSearchTerms(query)
  const naturalPhrase = getNaturalSearchPhrase(query)
  const canUseSessionFts = canUseSessionSearchFts(query)

  const sharedOpts = {
    ...(source ? { source } : {}),
    ...(since ? { since } : {}),
    ...(onlyPinned ? { onlyPinned } : {}),
    ...(identityKey ? { identityKey } : {}),
  }

  if (naturalTerms.length === 1) {
    return searchFragmentSessionFallback(db, naturalTerms, naturalPhrase, rowLimit, 'fts', sharedOpts).slice(0, limit)
  }

  const groups = buildSearchPlan(query).map(step => {
    if (naturalTerms.length > 1 && (step.matchType === 'phrase' || step.matchType === 'all_terms')) {
      return searchFragmentSessionFallback(db, naturalTerms, naturalPhrase, rowLimit, step.matchType, sharedOpts)
    }

    const ftsTable = selectFtsTableKind(query) === 'trigram' ? 'messages_fts_trigram' : 'messages_fts'
    const rows = searchFragmentRows(db, ftsTable, step.query, rowLimit, sharedOpts)
    return collapseFragmentRows(rows, step.matchType)
  })

  return mergeFragmentGroups(groups, limit)
}

export function searchSessionPreview(
  db: Database.Database,
  query: string,
  opts: { limit?: number; source?: SessionSource; since?: string } = {},
): FragmentResult[] {
  const { limit = 5, source, since } = opts
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return []

  const terms = getNaturalSearchTerms(query)
  const previewTerms = terms.length > 0 ? terms : [normalizedQuery]
  const rows = searchPreviewRows(db, previewTerms, limit, {
    ...(source ? { source } : {}),
    ...(since ? { since } : {}),
  })
  const snippetRows = selectBestSessionSnippets(
    db,
    rows.map(row => row['sessionId'] as number),
    previewTerms,
  )

  return rows.map((row, index) => {
    const sessionId = row['sessionId'] as number
    const snippetRow = snippetRows.get(sessionId)
    const snippetSource = snippetRow?.contentText ?? String(row['sessionTitle'] ?? '')
    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)

    return {
      rank: index + 1,
      sessionId,
      sessionUuid: row['sessionUuid'] as string,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: snippetRow?.matchingMessageCount ?? 1,
      matchType: 'all_terms',
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: buildLikeSnippet(snippetSource, previewTerms),
      messageId: snippetRow?.messageId ?? 0,
      messageRole: snippetRow?.messageRole ?? 'system',
      messageTimestamp: snippetRow?.messageTimestamp ?? (row['startedAt'] as string),
    }
  })
}

function searchFragmentRows(
  db: Database.Database,
  ftsTable: 'messages_fts' | 'messages_fts_trigram',
  ftsQuery: string,
  limit: number,
  opts: { source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyPinned, identityKey } = opts
  const conditions: string[] = [`${ftsTable} MATCH ?`, 'm.is_sidechain = 0']
  const params: (string | number)[] = [ftsQuery]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('m.timestamp >= ?')
    params.push(since)
  }
  if (onlyPinned) {
    conditions.push("EXISTS (SELECT 1 FROM pins WHERE pins.session_uuid = sess.session_uuid)")
  }
  if (identityKey) {
    conditions.push('p.identity_key = ?')
    params.push(identityKey)
  }
  params.push(limit)

  const sql = `
    SELECT
      rank,
      m.id          AS messageId,
      m.role        AS messageRole,
      m.timestamp   AS messageTimestamp,
      sess.id       AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title    AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd      AS cwd,
      p.display_path AS project,
      src2.name     AS source,
      snippet(${ftsTable}, -1, '<mark>', '</mark>', '…', 20) AS snippet
    FROM ${ftsTable}
    JOIN messages m ON m.id = ${ftsTable}.rowid
    JOIN sessions sess ON sess.id = m.session_id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY rank
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function searchPreviewRows(
  db: Database.Database,
  terms: string[],
  limit: number,
  opts: { source?: SessionSource; since?: string } = {},
): Array<Record<string, unknown>> {
  const { source, since } = opts
  const scoreParts: string[] = []
  const scoreParams: string[] = []
  const whereClauses: string[] = []
  const whereParams: string[] = []

  for (const term of terms) {
    const containsPattern = toLikePattern(term)
    const prefixPattern = `${escapeLike(term)}%`
    scoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`)
    scoreParams.push(prefixPattern)
    scoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`)
    scoreParams.push(containsPattern)
    scoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 4 ELSE 0 END`)
    scoreParams.push(containsPattern)
    scoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(containsPattern)

    whereClauses.push(`(
      ss.title LIKE ? ESCAPE '\\'
      OR ss.user_text LIKE ? ESCAPE '\\'
      OR ss.assistant_text LIKE ? ESCAPE '\\'
    )`)
    whereParams.push(containsPattern, containsPattern, containsPattern)
  }

  const conditions = [...whereClauses]
  const params: Array<string | number> = [...scoreParams, ...whereParams]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  params.push(limit)

  const previewScoreExpr = scoreParts.join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      ${previewScoreExpr} AS previewScore
    FROM sessions sess
    JOIN session_search ss ON ss.session_id = sess.id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY previewScore DESC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function collapseFragmentRows(rows: Array<Record<string, unknown>>, matchType: SearchMatchType): FragmentResult[] {
  const seen = new Map<string, FragmentResult>()
  const ordered: FragmentResult[] = []

  for (const row of rows) {
    const sessionUuid = row['sessionUuid'] as string
    const existing = seen.get(sessionUuid)

    if (existing) {
      existing.matchCount += 1
      continue
    }

    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)
    const fragment: FragmentResult = {
      rank: ordered.length + 1,
      sessionId: row['sessionId'] as number,
      sessionUuid,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: 1,
      matchType,
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: row['snippet'] as string,
      messageId: row['messageId'] as number,
      messageRole: row['messageRole'] as string,
      messageTimestamp: row['messageTimestamp'] as string,
    }

    seen.set(sessionUuid, fragment)
    ordered.push(fragment)
  }

  return ordered
}

function mergeFragmentGroups(groups: FragmentResult[][], limit: number): FragmentResult[] {
  const merged: FragmentResult[] = []
  const seen = new Map<string, FragmentResult>()

  for (const group of groups) {
    for (const fragment of group) {
      const existing = seen.get(fragment.sessionUuid)
      if (existing) {
        existing.matchCount = Math.max(existing.matchCount, fragment.matchCount)
        continue
      }
      if (merged.length >= limit) continue

      const next = {
        ...fragment,
        rank: merged.length + 1,
      }
      merged.push(next)
      seen.set(next.sessionUuid, next)
    }
  }

  return merged
}

function searchFragmentSessionFallback(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): FragmentResult[] {
  if (terms.length < 1) return []

  const rows = searchSessionRowsByTerms(db, terms, phrase, limit, matchType, opts)
  const snippetRows = selectBestSessionSnippets(
    db,
    rows.map(row => row['sessionId'] as number),
    terms,
  )
  type RankedFallbackRow = Omit<FragmentResult, 'rank'> & {
    _titleMatchScore: number
    _userMatchScore: number
    _assistantMatchScore: number
    _sameMessageCoverage: number
  }
  const ranked = rows.map((row) => {
    const snippetRow = snippetRows.get(row['sessionId'] as number)
    const snippetSource = snippetRow?.contentText ?? String(row['sessionTitle'] ?? '')
    const profileLabel = getProfileLabelFromFilePath(row['filePath'] as string)

    return {
      sessionId: row['sessionId'] as number,
      sessionUuid: row['sessionUuid'] as string,
      sessionTitle: (row['sessionTitle'] as string | null) ?? '(no title)',
      matchCount: snippetRow?.matchingMessageCount ?? 1,
      matchType,
      source: row['source'] as SessionSource,
      ...(profileLabel ? { profileLabel } : {}),
      ...(row['cwd'] ? { cwd: row['cwd'] as string } : {}),
      project: row['project'] as string,
      startedAt: row['startedAt'] as string,
      snippet: buildLikeSnippet(snippetSource, terms),
      messageId: snippetRow?.messageId ?? 0,
      messageRole: snippetRow?.messageRole ?? 'system',
      messageTimestamp: snippetRow?.messageTimestamp ?? (row['startedAt'] as string),
      _titleMatchScore: row['titleMatchScore'] as number,
      _userMatchScore: row['userMatchScore'] as number,
      _assistantMatchScore: row['assistantMatchScore'] as number,
      _sameMessageCoverage: snippetRow?.termCoverage ?? 0,
    } satisfies RankedFallbackRow
  })

  ranked.sort((a, b) => {
    if (b._sameMessageCoverage !== a._sameMessageCoverage) {
      return b._sameMessageCoverage - a._sameMessageCoverage
    }
    if (b._titleMatchScore !== a._titleMatchScore) {
      return b._titleMatchScore - a._titleMatchScore
    }
    if (b._userMatchScore !== a._userMatchScore) {
      return b._userMatchScore - a._userMatchScore
    }
    if (b._assistantMatchScore !== a._assistantMatchScore) {
      return b._assistantMatchScore - a._assistantMatchScore
    }
    return String(b.startedAt).localeCompare(String(a.startedAt))
  })

  return ranked.map((row, index) => ({
    rank: index + 1,
    sessionId: row.sessionId,
    sessionUuid: row.sessionUuid,
    sessionTitle: row.sessionTitle,
    matchCount: row.matchCount,
    matchType: row.matchType,
    source: row.source,
    ...(row.profileLabel ? { profileLabel: row.profileLabel } : {}),
    ...(row.cwd ? { cwd: row.cwd } : {}),
    project: row.project,
    startedAt: row.startedAt,
    snippet: row.snippet,
    messageId: row.messageId,
    messageRole: row.messageRole,
    messageTimestamp: row.messageTimestamp,
  }))
}

function searchSessionRowsByTerms(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): Array<Record<string, unknown>> {
  if (canUseSessionSearchFts(phrase)) {
    return searchSessionRowsByFts(db, terms, phrase, limit, matchType, opts)
  }

  return searchSessionRowsByLike(db, terms, limit, opts)
}

function searchSessionRowsByLike(
  db: Database.Database,
  terms: string[],
  limit: number,
  opts: { source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyPinned, identityKey } = opts
  const titleScoreParts: string[] = []
  const whereClauses: string[] = []
  const scoreParams: string[] = []
  const whereParams: string[] = []

  for (const term of terms) {
    const pattern = toLikePattern(term)
    titleScoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    whereClauses.push(`(
      ss.title LIKE ? ESCAPE '\\'
      OR ss.user_text LIKE ? ESCAPE '\\'
      OR ss.assistant_text LIKE ? ESCAPE '\\'
    )`)
    whereParams.push(pattern, pattern, pattern)
  }

  const conditions = [...whereClauses]
  const params: Array<string | number> = [...scoreParams, ...whereParams]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  if (onlyPinned) {
    conditions.push("EXISTS (SELECT 1 FROM pins WHERE pins.session_uuid = sess.session_uuid)")
  }
  if (identityKey) {
    conditions.push('p.identity_key = ?')
    params.push(identityKey)
  }
  params.push(limit)

  const titleScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 0).join(' + ')
  const userScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 1).join(' + ')
  const assistantScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 2).join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      ${titleScoreExpr} AS titleMatchScore,
      ${userScoreExpr} AS userMatchScore,
      ${assistantScoreExpr} AS assistantMatchScore
    FROM sessions sess
    JOIN session_search ss ON ss.session_id = sess.id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY titleMatchScore DESC, userMatchScore DESC, assistantMatchScore DESC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function searchSessionRowsByFts(
  db: Database.Database,
  terms: string[],
  phrase: string,
  limit: number,
  matchType: SearchMatchType,
  opts: { source?: SessionSource; since?: string; onlyPinned?: boolean; identityKey?: string } = {},
): Array<Record<string, unknown>> {
  const { source, since, onlyPinned, identityKey } = opts
  const ftsTable = selectFtsTableKind(phrase) === 'trigram' ? 'session_search_fts_trigram' : 'session_search_fts'
  const ftsQuery = matchType === 'phrase'
    ? `"${phrase.replace(/"/g, '""')}"`
    : terms.map(term => `"${term.replace(/"/g, '""')}"`).join(' AND ')

  const titleScoreParts: string[] = []
  const scoreParams: string[] = []
  const likeParams: string[] = []

  for (const term of terms) {
    const pattern = toLikePattern(term)
    titleScoreParts.push(`CASE WHEN ss.title LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.user_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
    titleScoreParts.push(`CASE WHEN ss.assistant_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`)
    scoreParams.push(pattern)
  }

  const conditions = [`${ftsTable} MATCH ?`]
  const params: Array<string | number> = [...scoreParams, ftsQuery]

  if (source) {
    conditions.push('src2.name = ?')
    params.push(source)
  }
  if (since) {
    conditions.push('sess.started_at >= ?')
    params.push(since)
  }
  if (onlyPinned) {
    conditions.push("EXISTS (SELECT 1 FROM pins WHERE pins.session_uuid = sess.session_uuid)")
  }
  if (identityKey) {
    conditions.push('p.identity_key = ?')
    params.push(identityKey)
  }
  params.push(limit)

  const titleScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 0).join(' + ')
  const userScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 1).join(' + ')
  const assistantScoreExpr = titleScoreParts.filter((_, index) => index % 3 === 2).join(' + ')
  const sql = `
    SELECT
      sess.id AS sessionId,
      sess.session_uuid AS sessionUuid,
      sess.file_path AS filePath,
      sess.title AS sessionTitle,
      sess.started_at AS startedAt,
      sess.cwd AS cwd,
      p.display_path AS project,
      src2.name AS source,
      bm25(${ftsTable}, 5.0, 1.5, 0.8) AS ftsScore,
      ${titleScoreExpr} AS titleMatchScore,
      ${userScoreExpr} AS userMatchScore,
      ${assistantScoreExpr} AS assistantMatchScore
    FROM ${ftsTable}
    JOIN session_search ss ON ss.session_id = ${ftsTable}.rowid
    JOIN sessions sess ON sess.id = ss.session_id
    JOIN projects p ON p.id = sess.project_id
    JOIN sources src2 ON src2.id = sess.source_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY titleMatchScore DESC, userMatchScore DESC, assistantMatchScore DESC, ftsScore ASC, sess.started_at DESC
    LIMIT ?
  `

  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>
}

function selectBestSessionSnippets(
  db: Database.Database,
  sessionIds: number[],
  terms: string[],
) {
  type SessionSnippetRow = {
    sessionId: number
    messageId: number
    messageRole: string
    messageTimestamp: string
    contentText: string
    termCoverage?: number
    matchingMessageCount?: number
  }
  if (sessionIds.length === 0) return new Map<number, SessionSnippetRow>()
  const coverageExpr = terms.map(() => `CASE WHEN content_text LIKE ? ESCAPE '\\' THEN 1 ELSE 0 END`).join(' + ')
  const anyClauses = terms.map(() => 'content_text LIKE ? ESCAPE \'\\\'').join(' OR ')
  const allPatterns = terms.map(toLikePattern)
  const anyPatterns = terms.map(toLikePattern)
  const sessionPlaceholders = sessionIds.map(() => '?').join(', ')

  const matchSql = `
    WITH raw AS (
      SELECT
        id AS messageId,
        session_id AS sessionId,
        role AS messageRole,
        timestamp AS messageTimestamp,
        content_text AS contentText,
        seq,
        ${coverageExpr} AS termCoverage
      FROM messages
      WHERE session_id IN (${sessionPlaceholders})
        AND is_sidechain = 0
        AND (${anyClauses})
    ),
    ranked AS (
      SELECT
        sessionId,
        messageId,
        messageRole,
        messageTimestamp,
        contentText,
        termCoverage,
        COUNT(*) OVER (PARTITION BY sessionId) AS matchingMessageCount,
        ROW_NUMBER() OVER (
          PARTITION BY sessionId
          ORDER BY termCoverage DESC, CASE WHEN messageRole = 'user' THEN 0 ELSE 1 END, seq
        ) AS rn
      FROM raw
    )
    SELECT
      sessionId,
      messageId,
      messageRole,
      messageTimestamp,
      contentText,
      termCoverage,
      matchingMessageCount
    FROM ranked
    WHERE rn = 1
  `

  const rows = db.prepare(matchSql).all(...allPatterns, ...sessionIds, ...anyPatterns) as SessionSnippetRow[]
  return new Map(rows.map(row => [row.sessionId, row]))
}

export function buildLikeSnippet(text: string, terms: string[]): string {
  const normalizedText = text.trim()
  if (!normalizedText) return ''

  // Case-insensitive hit search: the upstream SQL uses LIKE which is ASCII
  // case-insensitive, so the matched content may differ in case from the
  // query terms (e.g. user typed "dark fantasy", text has "Dark Fantasy").
  const lowerText = normalizedText.toLowerCase()
  const firstHit = terms
    .map(term => lowerText.indexOf(term.toLowerCase()))
    .filter(index => index >= 0)
    .sort((a, b) => a - b)[0] ?? 0

  const start = Math.max(0, firstHit - 60)
  const end = Math.min(normalizedText.length, firstHit + 140)
  let snippet = normalizedText.slice(start, end)

  if (start > 0) snippet = `…${snippet}`
  if (end < normalizedText.length) snippet = `${snippet}…`

  // Highlight preserving original casing via case-insensitive regex.
  const uniqueTerms = Array.from(new Set(terms)).sort((a, b) => b.length - a.length)
  for (const term of uniqueTerms) {
    if (!term) continue
    const pattern = new RegExp(escapeRegex(term), 'gi')
    snippet = snippet.replace(pattern, m => `<mark>${m}</mark>`)
  }

  return snippet
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toLikePattern(term: string): string {
  return `%${escapeLike(term)}%`
}

function escapeLike(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// ── Pins (sessions) ─────────────────────────────────────────────────────────

export function pinSession(db: Database.Database, sessionUuid: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO pins (session_uuid) VALUES (?)',
  ).run(sessionUuid)
}

export function unpinSession(db: Database.Database, sessionUuid: string): void {
  db.prepare('DELETE FROM pins WHERE session_uuid = ?').run(sessionUuid)
}

export function isPinned(db: Database.Database, sessionUuid: string): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM pins WHERE session_uuid = ?')
    .get(sessionUuid) as { hit: number } | undefined
  return row !== undefined
}

export function getPinnedUuids(db: Database.Database): string[] {
  const rows = db.prepare(`
    SELECT session_uuid AS uuid
    FROM pins
    WHERE EXISTS (SELECT 1 FROM sessions WHERE session_uuid = pins.session_uuid)
  `).all() as Array<{ uuid: string }>
  return rows.map(r => r.uuid)
}

export function listPinnedSessions(db: Database.Database): Session[] {
  const rows = db.prepare(`
    ${SESSION_SELECT}
    JOIN pins ON pins.session_uuid = s.session_uuid
    WHERE s.message_count > 0
    ORDER BY pins.pinned_at DESC
  `).all() as Array<Record<string, unknown>>
  return rows.map(rowToSession)
}

export function getStatus(db: Database.Database): StatusInfo {
  // Filter empty sessions so this matches every user-facing list, which
  // all gate on message_count > 0 (aborted starts and crash files have
  // zero messages but still occupy a row in the sessions table).
  const counts = db.prepare(`
    SELECT src.name, COUNT(*) AS cnt
    FROM sessions s JOIN sources src ON src.id = s.source_id
    WHERE s.message_count > 0
    GROUP BY src.name
  `).all() as Array<{ name: string; cnt: number }>

  const lastSync = db.prepare(`
    SELECT MAX(synced_at) AS last FROM sync_log WHERE status = 'ok'
  `).get() as { last: string | null }

  const totalSessions = counts.reduce((sum, r) => sum + r.cnt, 0)
  const claudeRow = counts.find(r => r.name === 'claude')
  const codexRow = counts.find(r => r.name === 'codex')
  const geminiRow = counts.find(r => r.name === 'gemini')
  const opencodeRow = counts.find(r => r.name === 'opencode')

  return {
    dbPath: DB_PATH,
    totalSessions,
    claudeSessions: claudeRow?.cnt ?? 0,
    codexSessions: codexRow?.cnt ?? 0,
    geminiSessions: geminiRow?.cnt ?? 0,
    opencodeSessions: opencodeRow?.cnt ?? 0,
    lastSyncedAt: lastSync?.last ?? null,
    dbSizeBytes: getDBSize(),
  }
}

export function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: r['id'] as number,
    projectId: r['projectId'] as number,
    sourceId: r['sourceId'] as number,
    sessionUuid: r['sessionUuid'] as string,
    filePath: r['filePath'] as string,
    title: r['title'] as string | null,
    startedAt: r['startedAt'] as string,
    endedAt: r['endedAt'] as string,
    messageCount: r['messageCount'] as number,
    hasToolUse: Boolean(r['hasToolUse']),
    cwd: r['cwd'] as string | null,
    model: r['model'] as string | null,
    source: r['source'] as SessionSource,
    projectDisplayPath: r['projectDisplayPath'] as string,
    projectDisplayName: r['projectDisplayName'] as string,
    scanFindingCount: (r['scanFindingCount'] as number | null) ?? 0,
    scanHighCount: (r['scanHighCount'] as number | null) ?? 0,
    scanPurgedCount: (r['scanPurgedCount'] as number | null) ?? 0,
    scanCompletedAt: (r['scanCompletedAt'] as string | null) ?? null,
  }
}

function getProfileLabelFromFilePath(filePath: string): string | undefined {
  const match = filePath.match(/\/\.(?:claude|codex)-profiles\/([^/]+)\//)
  return match?.[1]
}

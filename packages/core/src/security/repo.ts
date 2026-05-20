// Findings + allowlist repository.
//
// Plain better-sqlite3 prepared statements. No Effect here — this
// module is called from both the scan worker (Effect, wraps these in
// Effect.sync) and the IPC handlers (Promise-shaped). Keeping it
// effect-free preserves the worker / boundary split documented in
// the spec's "Implementation: Effect TS scope" section.
//
// Invariant: `findings.value_hash` is FNV-1a, computed via the
// share-kit-aligned `hashValueForRedactExclude` so identity matches
// across surfaces (share editor's exclude list, security allowlists).

import type Database from 'better-sqlite3'
import type { SensitiveKind } from '@spool-lab/redact'
import { HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS, severityOf } from '@spool-lab/redact'
import type {
  FindingRow,
  FindingState,
  RiskByCategoryRow,
  SessionWithFindingCounts,
} from './types.js'

// ─── Row shapes (snake_case as stored) ────────────────────────────

interface FindingRowDb {
  id: number
  session_id: number
  message_id: number | null
  kind: string
  value_hash: string
  confidence: number
  provider: string
  start_offset: number
  end_offset: number
  state: FindingState
  detected_at: string
  state_changed_at: string | null
}

function rowToFinding(r: FindingRowDb): FindingRow {
  return {
    id: r.id,
    sessionId: r.session_id,
    messageId: r.message_id,
    kind: r.kind as SensitiveKind,
    valueHash: r.value_hash,
    confidence: r.confidence,
    provider: r.provider,
    startOffset: r.start_offset,
    endOffset: r.end_offset,
    state: r.state,
    detectedAt: r.detected_at,
    stateChangedAt: r.state_changed_at,
  }
}

// ─── Filters ──────────────────────────────────────────────────────

export interface FindingFilter {
  sessionId?: number
  kind?: SensitiveKind
  /** Multi-select kinds. When non-empty takes precedence over `kind`.
   *  Used by the Security page filter pills which support clicking
   *  multiple chips to OR them together. */
  kinds?: readonly SensitiveKind[]
  state?: FindingState | 'any'
  severity?: 'high' | 'low'
}

export interface SessionFindingFilter {
  kind?: SensitiveKind
  kinds?: readonly SensitiveKind[]
  state?: FindingState | 'any'
  severity?: 'high' | 'low'
  /** Free-text on session title. */
  text?: string
}

// ─── Insert / delete (scan path) ──────────────────────────────────

export interface FindingInput {
  sessionId: number
  messageId: number | null
  kind: SensitiveKind
  valueHash: string
  confidence: number
  provider: string
  startOffset: number
  endOffset: number
  /** Allowlist hit at insert time → 'dismissed'; else 'active'. */
  state: FindingState
}

/** Insert a batch of findings. Caller wraps in a transaction. */
export function insertFindings(db: Database.Database, rows: readonly FindingInput[]): void {
  if (rows.length === 0) return
  const stmt = db.prepare(
    `INSERT INTO findings
       (session_id, message_id, kind, value_hash, confidence, provider,
        start_offset, end_offset, state, state_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const r of rows) {
    stmt.run(
      r.sessionId,
      r.messageId,
      r.kind,
      r.valueHash,
      r.confidence,
      r.provider,
      r.startOffset,
      r.endOffset,
      r.state,
      r.state !== 'active' ? new Date().toISOString() : null,
    )
  }
}

/** Delete all non-purged rows for the providers being rescanned —
 *  i.e. wipe the producer's previous output so the upcoming
 *  `insertFindings` is the canonical truth.
 *
 *  Includes `state='dismissed'` deliberately: those rows are derived
 *  state. The user's "ignore" decisions live in `allowlist_session`
 *  and `allowlist_global` (preserved here), and the scan path
 *  re-emits findings as `state='dismissed'` whenever it encounters a
 *  hit that matches an allowlist row. Re-inserting also keeps
 *  `findings.value_hash` aligned with the per-kind allowlist
 *  preference (security.json `kindAllowlist`) — without this delete,
 *  a mute → unmute cycle would accumulate phantom dismissed rows
 *  (one set per cycle), inflating audit counts and breaking
 *  `riskByCategory` totals over time.
 *
 *  Purged rows are the only state that's NOT producer-derived —
 *  they correspond to destructive `messages.content_text` rewrites
 *  the user explicitly approved. Preserving them is the audit
 *  contract documented in the design doc. */
export function deleteRefreshableFindings(
  db: Database.Database,
  sessionId: number,
  providers: readonly string[],
): void {
  if (providers.length === 0) return
  const placeholders = providers.map(() => '?').join(',')
  db.prepare(
    `DELETE FROM findings
     WHERE session_id = ?
       AND state IN ('active','dismissed')
       AND provider IN (${placeholders})`,
  ).run(sessionId, ...providers)
}

/** @deprecated Renamed to {@link deleteRefreshableFindings} after the
 *  active-only filter was found to leak phantom dismissed rows
 *  across mute→unmute cycles. Kept as a thin alias so callers
 *  outside the repo don't break mid-stack. */
export const deleteActiveFindings = deleteRefreshableFindings

// ─── Counts (denormalised on sessions) ────────────────────────────

/** Recompute sessions.scan_finding_count + scan_high_count from the
 *  findings table.
 *
 *  Counts EXCLUDE info-tier kinds (absolute-path, ip, internal-host).
 *  Those are stored — useful for an opt-in "Show informational
 *  signals" toggle — but they don't drive the Library row badge
 *  because their pattern-only signal has too high a false-positive
 *  rate to be meaningful at first glance. */
export function updateSessionCounts(db: Database.Database, sessionId: number): void {
  const active = db.prepare(
    `SELECT
        SUM(CASE WHEN kind NOT IN (${infoKindsPlaceholders()}) THEN 1 ELSE 0 END) AS total,
        SUM(CASE WHEN kind IN (${highKindsPlaceholders()}) THEN 1 ELSE 0 END) AS high
     FROM findings
     WHERE session_id = ? AND state = 'active'`,
  ).get(
    ...INFO_SEVERITY_KINDS_ARRAY,
    ...HIGH_SEVERITY_KINDS_ARRAY,
    sessionId,
  ) as { total: number | null; high: number | null }
  const purged = db.prepare(
    `SELECT COUNT(*) AS c
       FROM findings
      WHERE session_id = ? AND state = 'purged'`,
  ).get(sessionId) as { c: number }
  db.prepare(
    `UPDATE sessions
        SET scan_finding_count = ?,
            scan_high_count    = ?,
            scan_purged_count  = ?
      WHERE id = ?`,
  ).run(active.total ?? 0, active.high ?? 0, purged.c, sessionId)
}

const HIGH_SEVERITY_KINDS_ARRAY = Array.from(HIGH_SEVERITY_KINDS)
const INFO_SEVERITY_KINDS_ARRAY = Array.from(INFO_SEVERITY_KINDS)
function highKindsPlaceholders(): string {
  return HIGH_SEVERITY_KINDS_ARRAY.map(() => '?').join(',')
}
function infoKindsPlaceholders(): string {
  return INFO_SEVERITY_KINDS_ARRAY.map(() => '?').join(',')
}

export function setSessionScanProfile(
  db: Database.Database,
  sessionId: number,
  profile: string,
  completedAt: string,
): void {
  db.prepare(
    `UPDATE sessions
        SET scan_profile = ?, scan_completed_at = ?
      WHERE id = ?`,
  ).run(profile, completedAt, sessionId)
}

/** Set every session's scan_profile to NULL — used by "Rescan all" so
 *  every session re-enqueues. */
export function invalidateAllScanProfiles(db: Database.Database): number {
  const r = db.prepare('UPDATE sessions SET scan_profile = NULL').run()
  return r.changes
}

/** Drop the scan profile for one session — used by the sync cascade
 *  when a session's messages change after first scan. */
export function invalidateSessionScanProfile(db: Database.Database, sessionId: number): void {
  db.prepare(
    `UPDATE sessions
        SET scan_profile = NULL,
            scan_completed_at = NULL
      WHERE id = ?`,
  ).run(sessionId)
}

/** Sessions whose stored profile doesn't structurally match
 *  `currentProfile`. Used at boot for backfill enqueue. */
export function listSessionsNeedingScan(
  db: Database.Database,
  currentProfile: string,
): number[] {
  const rows = db.prepare(
    `SELECT id, scan_profile
       FROM sessions
      ORDER BY started_at DESC`,
  ).all() as Array<{ id: number; scan_profile: string | null }>
  const out: number[] = []
  for (const r of rows) {
    if (r.scan_profile === null || r.scan_profile !== currentProfile) {
      out.push(r.id)
    }
  }
  return out
}

// ─── Reads (UI path) ──────────────────────────────────────────────

export function listFindings(db: Database.Database, filter: FindingFilter): FindingRow[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filter.sessionId !== undefined) {
    where.push('session_id = ?')
    params.push(filter.sessionId)
  }
  if (filter.kinds && filter.kinds.length > 0) {
    const placeholders = filter.kinds.map(() => '?').join(',')
    where.push(`kind IN (${placeholders})`)
    params.push(...filter.kinds)
  } else if (filter.kind !== undefined) {
    where.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.state && filter.state !== 'any') {
    where.push('state = ?')
    params.push(filter.state)
  } else if (!filter.state) {
    // Default: active only.
    where.push("state = 'active'")
  }
  if (filter.severity === 'high') {
    where.push(`kind IN (${highKindsPlaceholders()})`)
    params.push(...HIGH_SEVERITY_KINDS_ARRAY)
  } else if (filter.severity === 'low') {
    where.push(`kind NOT IN (${highKindsPlaceholders()})`)
    params.push(...HIGH_SEVERITY_KINDS_ARRAY)
  }
  const sql = `SELECT * FROM findings
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY detected_at DESC, id DESC`
  const rows = db.prepare(sql).all(...params) as FindingRowDb[]
  return rows.map(rowToFinding)
}

export function listSessionsWithFindings(
  db: Database.Database,
  filter: SessionFindingFilter,
): SessionWithFindingCounts[] {
  // For category/severity-aware filtering we need to compute counts
  // from the findings table directly (denormalised counters can't
  // express "only api-key findings"). We always recompute here.
  const params: unknown[] = []
  const stateCondition = filter.state && filter.state !== 'any'
    ? 'f.state = ?'
    : "f.state = 'active'"
  if (filter.state && filter.state !== 'any') params.push(filter.state)

  let kindCondition = ''
  const explicitKinds: readonly string[] | undefined =
    filter.kinds && filter.kinds.length > 0
      ? filter.kinds
      : filter.kind !== undefined ? [filter.kind] : undefined
  if (explicitKinds) {
    const placeholders = explicitKinds.map(() => '?').join(',')
    kindCondition = `AND f.kind IN (${placeholders})`
    params.push(...explicitKinds)
  }
  let severityCondition = ''
  if (filter.severity === 'high') {
    severityCondition = `AND f.kind IN (${highKindsPlaceholders()})`
    params.push(...HIGH_SEVERITY_KINDS_ARRAY)
  } else if (filter.severity === 'low') {
    // Exclude both HIGH (not low) and INFO (noisy infra signals) so
    // `severity:low` returns only the identity-tier kinds (email,
    // phone, person-name, etc.).
    severityCondition = `AND f.kind NOT IN (${highKindsPlaceholders()}) AND f.kind NOT IN (${infoKindsPlaceholders()})`
    params.push(...HIGH_SEVERITY_KINDS_ARRAY, ...INFO_SEVERITY_KINDS_ARRAY)
  }

  // Default exclusion: info-tier findings don't surface a session on
  // their own — they're stored as an audit record (see Info drawer at
  // the bottom of the page). Only when the user has explicitly pinned
  // an info kind via filter.kind/filter.kinds do we let them through.
  let infoExclusion = ''
  if (!explicitKinds && filter.severity !== 'high' && filter.severity !== 'low') {
    infoExclusion = `AND f.kind NOT IN (${infoKindsPlaceholders()})`
    params.push(...INFO_SEVERITY_KINDS_ARRAY)
  }

  let textCondition = ''
  if (filter.text && filter.text.trim().length > 0) {
    textCondition = `AND s.title LIKE ?`
    params.push(`%${filter.text.trim()}%`)
  }

  const sql = `
    SELECT
      s.id              AS id,
      s.session_uuid    AS session_uuid,
      s.title           AS title,
      s.started_at      AS started_at,
      s.scan_completed_at AS scan_completed_at,
      s.scan_purged_count AS purged_count,
      s.message_count   AS message_count,
      s.model           AS model,
      s.cwd             AS cwd,
      src.name          AS source,
      p.display_name    AS project_display_name,
      SUM(1) AS finding_count,
      SUM(CASE WHEN f.kind IN (${highKindsPlaceholders()}) THEN 1 ELSE 0 END) AS high_count
    FROM sessions s
    JOIN findings f ON f.session_id = s.id
    JOIN sources src ON src.id = s.source_id
    JOIN projects p ON p.id = s.project_id
    WHERE ${stateCondition} ${kindCondition} ${severityCondition} ${infoExclusion} ${textCondition}
      AND COALESCE(s.message_count, 0) > 0
    GROUP BY s.id
    ORDER BY high_count DESC, finding_count DESC, s.started_at DESC
  `
  // Placeholder order matches SQL: SELECT's CASE WHEN IN (?) binds first,
  // then the WHERE clause's params.
  const allParams = [...HIGH_SEVERITY_KINDS_ARRAY, ...params]
  const rows = db.prepare(sql).all(...allParams) as Array<{
    id: number
    session_uuid: string
    title: string | null
    started_at: string
    scan_completed_at: string | null
    purged_count: number | null
    message_count: number | null
    model: string | null
    cwd: string | null
    source: string
    project_display_name: string | null
    finding_count: number
    high_count: number | null
  }>
  return rows.map(r => ({
    id: r.id,
    sessionUuid: r.session_uuid,
    title: r.title,
    startedAt: r.started_at,
    scanCompletedAt: r.scan_completed_at,
    findingCount: r.finding_count,
    highCount: r.high_count ?? 0,
    purgedCount: r.purged_count ?? 0,
    source: r.source,
    messageCount: r.message_count ?? 0,
    model: r.model,
    cwd: r.cwd,
    projectDisplayName: r.project_display_name,
  }))
}

/** Risk by category — one row per kind that has ≥ 1 active finding.
 *  Drives the Watchtower-style panel on the Security page. */
export function riskByCategory(db: Database.Database): RiskByCategoryRow[] {
  const rows = db.prepare(
    `SELECT kind,
            COUNT(*) AS count,
            COUNT(DISTINCT session_id) AS sessions
       FROM findings
      WHERE state = 'active'
      GROUP BY kind
      ORDER BY count DESC`,
  ).all() as Array<{ kind: string; count: number; sessions: number }>
  return rows.map(r => ({
    kind: r.kind as SensitiveKind,
    severity: severityOf(r.kind as SensitiveKind),
    count: r.count,
    sessions: r.sessions,
  }))
}

/** Read the live raw value for one finding. Used by the UI's review
 *  panel and the Purge confirm dialog. Returns null when the finding
 *  no longer points at a valid message (race against session
 *  deletion) or has been purged (offsets now point at the mask). */
export function getFindingValue(db: Database.Database, findingId: number): string | null {
  const row = db.prepare(
    `SELECT f.start_offset, f.end_offset, f.state, m.content_text
       FROM findings f
       LEFT JOIN messages m ON m.id = f.message_id
      WHERE f.id = ?`,
  ).get(findingId) as
    | { start_offset: number; end_offset: number; state: FindingState; content_text: string | null }
    | undefined
  if (!row || row.content_text === null) return null
  if (row.state === 'purged') return null
  return row.content_text.slice(row.start_offset, row.end_offset)
}

/** Bulk version of `getFindingValue` — one SQL query for N finding
 *  ids instead of N round-trips. Caller fans the result map back out
 *  by id; missing keys are treated as `null` (purged / vanished). */
export function getFindingValues(
  db: Database.Database,
  findingIds: readonly number[],
): Record<number, string | null> {
  const out: Record<number, string | null> = {}
  if (findingIds.length === 0) return out
  const placeholders = findingIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT f.id, f.start_offset, f.end_offset, f.state, m.content_text
       FROM findings f
       LEFT JOIN messages m ON m.id = f.message_id
      WHERE f.id IN (${placeholders})`,
  ).all(...findingIds) as Array<{
    id: number
    start_offset: number
    end_offset: number
    state: FindingState
    content_text: string | null
  }>
  for (const r of rows) {
    if (r.content_text === null || r.state === 'purged') {
      out[r.id] = null
    } else {
      out[r.id] = r.content_text.slice(r.start_offset, r.end_offset)
    }
  }
  // Fill in nulls for ids that didn't come back (deleted / cascade).
  for (const id of findingIds) {
    if (!(id in out)) out[id] = null
  }
  return out
}

// ─── Allowlists ───────────────────────────────────────────────────

export interface AllowlistSnapshot {
  /** (kind|value_hash) keys for this session. */
  session: Set<string>
  /** (kind|value_hash) keys, global scope. */
  global: Set<string>
}

const allowKey = (kind: string, hash: string) => `${kind}|${hash}`

export function getAllowlists(db: Database.Database, sessionId: number): AllowlistSnapshot {
  const sessionRows = db.prepare(
    'SELECT kind, value_hash FROM allowlist_session WHERE session_id = ?',
  ).all(sessionId) as Array<{ kind: string; value_hash: string }>
  const globalRows = db.prepare(
    'SELECT kind, value_hash FROM allowlist_global',
  ).all() as Array<{ kind: string; value_hash: string }>
  return {
    session: new Set(sessionRows.map(r => allowKey(r.kind, r.value_hash))),
    global: new Set(globalRows.map(r => allowKey(r.kind, r.value_hash))),
  }
}

export function isAllowlisted(
  allow: AllowlistSnapshot,
  kind: SensitiveKind,
  valueHash: string,
): boolean {
  const key = allowKey(kind, valueHash)
  return allow.session.has(key) || allow.global.has(key)
}

export function addAllowlistSession(
  db: Database.Database,
  sessionId: number,
  kind: SensitiveKind,
  valueHash: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO allowlist_session (session_id, kind, value_hash)
     VALUES (?, ?, ?)`,
  ).run(sessionId, kind, valueHash)
}

export function addAllowlistGlobal(
  db: Database.Database,
  kind: SensitiveKind,
  valueHash: string,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO allowlist_global (kind, value_hash) VALUES (?, ?)`,
  ).run(kind, valueHash)
}

export function removeAllowlistSession(
  db: Database.Database,
  sessionId: number,
  kind: SensitiveKind,
  valueHash: string,
): void {
  db.prepare(
    `DELETE FROM allowlist_session
      WHERE session_id = ? AND kind = ? AND value_hash = ?`,
  ).run(sessionId, kind, valueHash)
}

export function removeAllowlistGlobal(
  db: Database.Database,
  kind: SensitiveKind,
  valueHash: string,
): void {
  db.prepare(
    `DELETE FROM allowlist_global WHERE kind = ? AND value_hash = ?`,
  ).run(kind, valueHash)
}

export interface AllowlistEntryRow {
  scope: 'session' | 'global'
  kind: SensitiveKind
  valueHash: string
  createdAt: string
  /** Session row context — null for global entries. */
  sessionUuid: string | null
  sessionTitle: string | null
}

/** All allowlist rows from both tables, joined with the originating
 *  session metadata. Drives the Settings → Security pane's "Manage…"
 *  modal so the user can review and revoke past decisions. */
export function listAllowlistEntries(db: Database.Database): AllowlistEntryRow[] {
  const sessionRows = db.prepare(
    `SELECT a.kind          AS kind,
            a.value_hash    AS value_hash,
            a.created_at    AS created_at,
            s.session_uuid  AS session_uuid,
            s.title         AS session_title
       FROM allowlist_session a
       JOIN sessions s ON s.id = a.session_id
      ORDER BY a.created_at DESC`,
  ).all() as Array<{
    kind: string
    value_hash: string
    created_at: string
    session_uuid: string
    session_title: string | null
  }>
  const globalRows = db.prepare(
    `SELECT kind, value_hash, created_at
       FROM allowlist_global
      ORDER BY created_at DESC`,
  ).all() as Array<{
    kind: string
    value_hash: string
    created_at: string
  }>
  return [
    ...globalRows.map((r): AllowlistEntryRow => ({
      scope: 'global',
      kind: r.kind as SensitiveKind,
      valueHash: r.value_hash,
      createdAt: r.created_at,
      sessionUuid: null,
      sessionTitle: null,
    })),
    ...sessionRows.map((r): AllowlistEntryRow => ({
      scope: 'session',
      kind: r.kind as SensitiveKind,
      valueHash: r.value_hash,
      createdAt: r.created_at,
      sessionUuid: r.session_uuid,
      sessionTitle: r.session_title,
    })),
  ]
}

// ─── Mutations called from IPC dismiss handlers ───────────────────

/** Flip a finding to 'dismissed' and, depending on scope, write the
 *  allowlist entry so future rescans honor the decision. Caller
 *  wraps in a transaction. */
export function dismissFinding(
  db: Database.Database,
  findingId: number,
  scope: 'session' | 'global',
): void {
  const f = db.prepare(
    'SELECT session_id, kind, value_hash FROM findings WHERE id = ?',
  ).get(findingId) as { session_id: number; kind: string; value_hash: string } | undefined
  if (!f) return
  db.prepare(
    `UPDATE findings
        SET state = 'dismissed',
            state_changed_at = datetime('now')
      WHERE id = ?`,
  ).run(findingId)
  if (scope === 'session') {
    addAllowlistSession(db, f.session_id, f.kind as SensitiveKind, f.value_hash)
  } else {
    addAllowlistGlobal(db, f.kind as SensitiveKind, f.value_hash)
  }
  updateSessionCounts(db, f.session_id)
}

/** Re-activate a dismissed finding and remove the allowlist entry
 *  that pinned it (both scopes, since UI doesn't always know which). */
export function undismissFinding(db: Database.Database, findingId: number): void {
  const f = db.prepare(
    'SELECT session_id, kind, value_hash FROM findings WHERE id = ?',
  ).get(findingId) as { session_id: number; kind: string; value_hash: string } | undefined
  if (!f) return
  db.prepare(
    `UPDATE findings
        SET state = 'active',
            state_changed_at = datetime('now')
      WHERE id = ?`,
  ).run(findingId)
  removeAllowlistSession(db, f.session_id, f.kind as SensitiveKind, f.value_hash)
  removeAllowlistGlobal(db, f.kind as SensitiveKind, f.value_hash)
  updateSessionCounts(db, f.session_id)
}

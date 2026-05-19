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
import { HIGH_SEVERITY_KINDS, INFO_SEVERITY_KINDS } from '@spool-lab/redact'
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
  state?: FindingState | 'any'
  severity?: 'high' | 'low'
}

export interface SessionFindingFilter {
  kind?: SensitiveKind
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

/** Delete only state='active' rows for the providers being rescanned.
 *  Dismissed and purged rows survive — they are the user's decisions
 *  and the audit trail. */
export function deleteActiveFindings(
  db: Database.Database,
  sessionId: number,
  providers: readonly string[],
): void {
  if (providers.length === 0) return
  const placeholders = providers.map(() => '?').join(',')
  db.prepare(
    `DELETE FROM findings
     WHERE session_id = ?
       AND state = 'active'
       AND provider IN (${placeholders})`,
  ).run(sessionId, ...providers)
}

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
  const row = db.prepare(
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
  db.prepare(
    `UPDATE sessions
        SET scan_finding_count = ?,
            scan_high_count    = ?
      WHERE id = ?`,
  ).run(row.total ?? 0, row.high ?? 0, sessionId)
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
  if (filter.kind !== undefined) {
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
  const conditions: string[] = ["f.state = COALESCE(NULL, 'active')"] // overridden below
  conditions.length = 0
  const stateCondition = filter.state && filter.state !== 'any'
    ? 'f.state = ?'
    : "f.state = 'active'"
  if (filter.state && filter.state !== 'any') params.push(filter.state)

  let kindCondition = ''
  if (filter.kind !== undefined) {
    kindCondition = 'AND f.kind = ?'
    params.push(filter.kind)
  }
  let severityCondition = ''
  if (filter.severity === 'high') {
    severityCondition = `AND f.kind IN (${highKindsPlaceholders()})`
    params.push(...HIGH_SEVERITY_KINDS_ARRAY)
  } else if (filter.severity === 'low') {
    severityCondition = `AND f.kind NOT IN (${highKindsPlaceholders()})`
    params.push(...HIGH_SEVERITY_KINDS_ARRAY)
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
      SUM(1) AS finding_count,
      SUM(CASE WHEN f.kind IN (${highKindsPlaceholders()}) THEN 1 ELSE 0 END) AS high_count
    FROM sessions s
    JOIN findings f ON f.session_id = s.id
    WHERE ${stateCondition} ${kindCondition} ${severityCondition} ${textCondition}
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
  }))
}

/** Risk by category — one row per kind that has ≥ 1 active finding.
 *  Drives the Watchtower-style panel on the Security page. */
export function riskByCategory(db: Database.Database): RiskByCategoryRow[] {
  const rows = db.prepare(
    `SELECT kind, COUNT(*) AS count
       FROM findings
      WHERE state = 'active'
      GROUP BY kind
      ORDER BY count DESC`,
  ).all() as Array<{ kind: string; count: number }>
  return rows.map(r => ({
    kind: r.kind as SensitiveKind,
    severity: HIGH_SEVERITY_KINDS.has(r.kind as SensitiveKind) ? 'high' : 'low',
    count: r.count,
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

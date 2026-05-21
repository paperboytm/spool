import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/db.js'
import {
  insertFindings,
  deleteActiveFindings,
  updateSessionCounts,
  setSessionScanProfile,
  invalidateAllScanProfiles,
  invalidateSessionScanProfile,
  listSessionsNeedingScan,
  listFindings,
  listFindingsPage,
  listSessionsWithFindings,
  listSessionsWithFindingsPage,
  countSessionsWithFindings,
  riskByCategory,
  getFindingValue,
  getAllowlists,
  isAllowlisted,
  addAllowlistSession,
  addAllowlistGlobal,
  removeAllowlistSession,
  removeAllowlistGlobal,
  dismissFinding,
  undismissFinding,
} from './repo.js'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  // seed one project + two sessions + one message per session
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
     VALUES (1, 1, 1, 's-1', '/p/s-1', 'Session 1', '2026-01-01', '2026-01-01', 1),
            (2, 1, 1, 's-2', '/p/s-2', 'Other Session', '2026-01-02', '2026-01-02', 1)`,
  ).run()
  db.prepare(
    `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
     VALUES (10, 1, 1, 'user', 'My AWS key is AKIAIOSFODNN7EXAMPLE and my email is a@b.com', '2026-01-01', 0),
            (20, 2, 1, 'user', 'unrelated content', '2026-01-02', 0)`,
  ).run()
  return db
}

describe('repo: insert + count + delete cycle', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('insertFindings + updateSessionCounts roundtrip', () => {
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 50, endOffset: 57, state: 'active' },
    ])
    updateSessionCounts(db, 1)
    const row = db.prepare('SELECT scan_finding_count, scan_high_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number; scan_high_count: number }
    expect(row.scan_finding_count).toBe(2)
    expect(row.scan_high_count).toBe(1) // api-key is high; email is low
  })

  it('deleteRefreshableFindings respects the providers filter', () => {
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'person-name', valueHash: 'h2', confidence: 0.7, provider: 'pf', startOffset: 0, endOffset: 5, state: 'active' },
    ])
    deleteActiveFindings(db, 1, ['regex'])
    const rows = listFindings(db, { sessionId: 1, state: 'any' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.provider).toBe('pf')
  })

  it('deleteRefreshableFindings wipes BOTH active and dismissed for the providers — needed to avoid phantom-dismissed accumulation across mute/unmute cycles', () => {
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 50, endOffset: 57, state: 'dismissed' },
    ])
    deleteActiveFindings(db, 1, ['regex'])
    const rows = listFindings(db, { sessionId: 1, state: 'any' })
    expect(rows).toHaveLength(0)
  })

  it('deleteRefreshableFindings preserves purged rows (audit trail for destructive actions)', () => {
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'purged' },
    ])
    deleteActiveFindings(db, 1, ['regex'])
    const rows = listFindings(db, { sessionId: 1, state: 'any' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.state).toBe('purged')
  })
})

describe('repo: list + filter', () => {
  let db: Database.Database
  beforeEach(() => {
    db = setupDb()
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 50, endOffset: 57, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'phone', valueHash: 'h3', confidence: 0.6, provider: 'regex', startOffset: 60, endOffset: 70, state: 'dismissed' },
      { sessionId: 2, messageId: 20, kind: 'api-key', valueHash: 'h4', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
    ])
    updateSessionCounts(db, 1)
    updateSessionCounts(db, 2)
  })

  it('listFindings defaults to active only', () => {
    expect(listFindings(db, { sessionId: 1 })).toHaveLength(2)
  })
  it('listFindings honours state="any"', () => {
    expect(listFindings(db, { sessionId: 1, state: 'any' })).toHaveLength(3)
  })
  it('listFindings filters by kind', () => {
    const rows = listFindings(db, { kind: 'api-key' })
    expect(rows.map(r => r.sessionId).sort()).toEqual([1, 2])
  })
  it('listFindings filters by severity', () => {
    expect(listFindings(db, { severity: 'high' }).map(r => r.kind))
      .toEqual(['api-key', 'api-key'])
    expect(listFindings(db, { severity: 'low' }).map(r => r.kind))
      .toEqual(['email'])
  })

  it('riskByCategory excludes dismissed, orders by count, and reports distinct sessions', () => {
    const cats = riskByCategory(db)
    expect(cats).toEqual([
      { kind: 'api-key', severity: 'high', count: 2, sessions: 2 },
      { kind: 'email',   severity: 'low',  count: 1, sessions: 1 },
    ])
  })

  it('listSessionsWithFindings excludes sessions with zero active findings', () => {
    const rows = listSessionsWithFindings(db, {})
    expect(rows.map(r => r.sessionUuid).sort()).toEqual(['s-1', 's-2'])
    const s1 = rows.find(r => r.sessionUuid === 's-1')!
    expect(s1.findingCount).toBe(2)
    expect(s1.highCount).toBe(1)
  })

  it('listSessionsWithFindings filters by kind', () => {
    const rows = listSessionsWithFindings(db, { kind: 'email' })
    expect(rows.map(r => r.sessionUuid)).toEqual(['s-1'])
  })

  it('listSessionsWithFindings excludes sessions whose message_count dropped to 0 — stale finding rows from emptied/pruned sessions must not surface', () => {
    // s-2 keeps its message row but its denormalised counter falls to
    // 0 (mirrors the prod case where sessions were captured with zero
    // body text — likely a source-file edge case — yet finding rows
    // already exist).
    db.prepare(`UPDATE sessions SET message_count = 0 WHERE id = 2`).run()
    const rows = listSessionsWithFindings(db, {})
    expect(rows.map(r => r.sessionUuid)).toEqual(['s-1'])
  })

  it('listSessionsWithFindings free-text matches session title', () => {
    expect(listSessionsWithFindings(db, { text: 'Other' }).map(r => r.sessionUuid)).toEqual(['s-2'])
    expect(listSessionsWithFindings(db, { text: 'nope' })).toHaveLength(0)
  })

  it('getFindingValue reads live text at offsets', () => {
    const f = listFindings(db, { kind: 'api-key', sessionId: 1 })[0]!
    expect(getFindingValue(db, f.id)).toBe('AKIAIOSFODNN7EXAMPLE')
  })
  it('getFindingValue returns null for purged rows', () => {
    const f = listFindings(db, { kind: 'api-key', sessionId: 1 })[0]!
    db.prepare("UPDATE findings SET state='purged' WHERE id = ?").run(f.id)
    expect(getFindingValue(db, f.id)).toBeNull()
  })
})

describe('repo: pagination', () => {
  let db: Database.Database
  beforeEach(() => {
    db = setupDb()
    // 12 findings in session 1, all api-key (high) with distinct
    // detected_at timestamps so order is deterministic.
    const rows = Array.from({ length: 12 }, (_, i) => ({
      sessionId: 1,
      messageId: 10,
      kind: 'api-key' as const,
      valueHash: `h-${i}`,
      confidence: 0.9,
      provider: 'regex',
      startOffset: i,
      endOffset: i + 1,
      state: 'active' as const,
    }))
    insertFindings(db, rows)
    // Spread detected_at so ordering is unambiguous — default insert
    // assigns the same timestamp to every row, which leaves only `id
    // DESC` as the tiebreaker. We want to exercise BOTH clauses.
    for (let i = 0; i < 12; i++) {
      db.prepare(
        `UPDATE findings SET detected_at = ? WHERE value_hash = ?`,
      ).run(`2026-01-01T00:00:${(10 + i).toString().padStart(2, '0')}Z`, `h-${i}`)
    }
    updateSessionCounts(db, 1)
  })

  it('listFindings honours limit only', () => {
    const rows = listFindings(db, { sessionId: 1, limit: 5 })
    expect(rows).toHaveLength(5)
  })

  it('listFindings honours limit + offset', () => {
    const all = listFindings(db, { sessionId: 1 })
    expect(all).toHaveLength(12)
    const first = listFindings(db, { sessionId: 1, limit: 5, offset: 0 })
    const second = listFindings(db, { sessionId: 1, limit: 5, offset: 5 })
    expect(first.map(r => r.valueHash)).toEqual(all.slice(0, 5).map(r => r.valueHash))
    expect(second.map(r => r.valueHash)).toEqual(all.slice(5, 10).map(r => r.valueHash))
  })

  it('listFindings filter semantics unchanged when limit absent', () => {
    // Add a non-active row that the default state filter should
    // exclude. Pagination machinery must not affect WHERE semantics.
    db.prepare(`INSERT INTO findings (session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state)
                VALUES (1, 10, 'email', 'h-dismissed', 0.5, 'regex', 0, 1, 'dismissed')`).run()
    const def = listFindings(db, { sessionId: 1 })
    expect(def).toHaveLength(12) // dismissed row excluded
    expect(def.every(r => r.state === 'active')).toBe(true)
  })

  it('listFindings stable ordering across pages — no dup, no skip', () => {
    // Sweep all 12 rows in 3 pages of 5/5/2 and assert the union has
    // no duplicates and matches the full-fetch order.
    const all = listFindings(db, { sessionId: 1 })
    const p1 = listFindings(db, { sessionId: 1, limit: 5, offset: 0 })
    const p2 = listFindings(db, { sessionId: 1, limit: 5, offset: 5 })
    const p3 = listFindings(db, { sessionId: 1, limit: 5, offset: 10 })
    const concat = [...p1, ...p2, ...p3]
    expect(concat.map(r => r.id)).toEqual(all.map(r => r.id))
    expect(new Set(concat.map(r => r.id)).size).toBe(12)
  })

  it('listFindingsPage sets hasMore=true when more rows exist', () => {
    const page = listFindingsPage(db, { sessionId: 1, limit: 5 })
    expect(page.rows).toHaveLength(5)
    expect(page.hasMore).toBe(true)
  })

  it('listFindingsPage sets hasMore=false on the last page (exact match)', () => {
    const page = listFindingsPage(db, { sessionId: 1, limit: 12 })
    expect(page.rows).toHaveLength(12)
    expect(page.hasMore).toBe(false)
  })

  it('listFindingsPage with no limit returns all rows + hasMore=false', () => {
    const page = listFindingsPage(db, { sessionId: 1 })
    expect(page.rows).toHaveLength(12)
    expect(page.hasMore).toBe(false)
  })

  it('listSessionsWithFindings honours limit + offset and orders deterministically', () => {
    // Seed extra sessions so the result set spans multiple pages.
    for (let i = 3; i <= 8; i++) {
      db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (?, 1, 1, ?, ?, ?, ?, ?, 1)`,
      ).run(i, `s-${i}`, `/p/s-${i}`, `S${i}`, `2026-01-${(i + 1).toString().padStart(2, '0')}`, `2026-01-${(i + 1).toString().padStart(2, '0')}`)
      db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (?, ?, 1, 'user', 'x', '2026-01-01', 0)`,
      ).run(100 + i, i)
      insertFindings(db, [{
        sessionId: i, messageId: 100 + i, kind: 'api-key', valueHash: `gh-${i}`,
        confidence: 0.9, provider: 'regex', startOffset: 0, endOffset: 1, state: 'active',
      }])
      updateSessionCounts(db, i)
    }
    const all = listSessionsWithFindings(db, {})
    expect(all.length).toBeGreaterThanOrEqual(7)
    const p1 = listSessionsWithFindings(db, { limit: 3, offset: 0 })
    const p2 = listSessionsWithFindings(db, { limit: 3, offset: 3 })
    expect(p1.map(r => r.id)).toEqual(all.slice(0, 3).map(r => r.id))
    expect(p2.map(r => r.id)).toEqual(all.slice(3, 6).map(r => r.id))
    // No overlap between adjacent pages.
    const p1Ids = new Set(p1.map(r => r.id))
    expect(p2.some(r => p1Ids.has(r.id))).toBe(false)
  })

  it('listSessionsWithFindings semantics unchanged when limit absent', () => {
    // Filter by kind should still work normally — pagination is opt-in.
    const rows = listSessionsWithFindings(db, { kind: 'api-key' })
    expect(rows.map(r => r.sessionUuid).sort()).toContain('s-1')
  })

  it('listSessionsWithFindingsPage sets hasMore correctly', () => {
    // Seed 4 sessions with findings so we can probe both true and false.
    for (let i = 3; i <= 5; i++) {
      db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (?, 1, 1, ?, ?, ?, ?, ?, 1)`,
      ).run(i, `s-${i}`, `/p/s-${i}`, `S${i}`, `2026-01-${(i + 1).toString().padStart(2, '0')}`, `2026-01-${(i + 1).toString().padStart(2, '0')}`)
      db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (?, ?, 1, 'user', 'x', '2026-01-01', 0)`,
      ).run(100 + i, i)
      insertFindings(db, [{
        sessionId: i, messageId: 100 + i, kind: 'api-key', valueHash: `gh-${i}`,
        confidence: 0.9, provider: 'regex', startOffset: 0, endOffset: 1, state: 'active',
      }])
      updateSessionCounts(db, i)
    }
    const total = listSessionsWithFindings(db, {}).length
    const partial = listSessionsWithFindingsPage(db, { limit: total - 1 })
    expect(partial.hasMore).toBe(true)
    expect(partial.rows).toHaveLength(total - 1)
    const full = listSessionsWithFindingsPage(db, { limit: total })
    expect(full.hasMore).toBe(false)
    expect(full.rows).toHaveLength(total)
  })

  it('countSessionsWithFindings returns the same total as the unpaginated list', () => {
    const db = setupDb()
    for (let i = 3; i <= 9; i++) {
      db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (?, 1, 1, ?, ?, ?, '2026-01-01', '2026-01-01', 1)`,
      ).run(i, `c-${i}`, `/p/c-${i}`, `C${i}`)
      db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (?, ?, 1, 'user', 'x', '2026-01-01', 0)`,
      ).run(200 + i, i)
      insertFindings(db, [{
        sessionId: i, messageId: 200 + i, kind: i <= 5 ? 'api-key' : 'email', valueHash: `c-${i}`,
        confidence: 0.9, provider: 'regex', startOffset: 0, endOffset: 1, state: 'active',
      }])
      updateSessionCounts(db, i)
    }
    expect(countSessionsWithFindings(db, {})).toBe(listSessionsWithFindings(db, {}).length)
    expect(countSessionsWithFindings(db, { kind: 'api-key' }))
      .toBe(listSessionsWithFindings(db, { kind: 'api-key' }).length)
  })

  it('countSessionsWithFindings is independent of limit/offset on the same filter', () => {
    const db = setupDb()
    for (let i = 3; i <= 7; i++) {
      db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (?, 1, 1, ?, ?, ?, '2026-01-01', '2026-01-01', 1)`,
      ).run(i, `d-${i}`, `/p/d-${i}`, `D${i}`)
      db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (?, ?, 1, 'user', 'x', '2026-01-01', 0)`,
      ).run(300 + i, i)
      insertFindings(db, [{
        sessionId: i, messageId: 300 + i, kind: 'api-key', valueHash: `d-${i}`,
        confidence: 0.9, provider: 'regex', startOffset: 0, endOffset: 1, state: 'active',
      }])
      updateSessionCounts(db, i)
    }
    const total = countSessionsWithFindings(db, {})
    expect(total).toBe(5)
    expect(countSessionsWithFindings(db, { limit: 2, offset: 0 })).toBe(total)
    expect(countSessionsWithFindings(db, { limit: 2, offset: 2 })).toBe(total)
  })
})

describe('repo: scan_profile lifecycle', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('setSessionScanProfile persists profile + completedAt', () => {
    setSessionScanProfile(db, 1, 'regex@3', '2026-01-10T00:00:00Z')
    const row = db.prepare('SELECT scan_profile, scan_completed_at FROM sessions WHERE id = 1').get() as { scan_profile: string; scan_completed_at: string }
    expect(row.scan_profile).toBe('regex@3')
    expect(row.scan_completed_at).toBe('2026-01-10T00:00:00Z')
  })

  it('invalidateSessionScanProfile clears both fields', () => {
    setSessionScanProfile(db, 1, 'regex@3', '2026-01-10T00:00:00Z')
    invalidateSessionScanProfile(db, 1)
    const row = db.prepare('SELECT scan_profile, scan_completed_at FROM sessions WHERE id = 1').get() as { scan_profile: string | null; scan_completed_at: string | null }
    expect(row.scan_profile).toBeNull()
    expect(row.scan_completed_at).toBeNull()
  })

  it('invalidateAllScanProfiles affects every session', () => {
    setSessionScanProfile(db, 1, 'regex@3', '2026-01-10')
    setSessionScanProfile(db, 2, 'regex@3', '2026-01-11')
    expect(invalidateAllScanProfiles(db)).toBe(2)
    const rows = db.prepare('SELECT scan_profile FROM sessions ORDER BY id').all() as Array<{ scan_profile: string | null }>
    expect(rows.map(r => r.scan_profile)).toEqual([null, null])
  })

  it('listSessionsNeedingScan returns NULL-profile sessions first', () => {
    setSessionScanProfile(db, 1, 'regex@3', '2026-01-10')
    // session 2 still has NULL profile
    expect(listSessionsNeedingScan(db, 'regex@3')).toEqual([2])
  })

  it('listSessionsNeedingScan returns sessions whose stored profile mismatches', () => {
    setSessionScanProfile(db, 1, 'regex@2', '2026-01-10')
    setSessionScanProfile(db, 2, 'regex@3', '2026-01-11')
    expect(listSessionsNeedingScan(db, 'regex@3')).toEqual([1])
  })
})

describe('repo: allowlist', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('addAllowlistSession is idempotent + getAllowlists reflects it', () => {
    addAllowlistSession(db, 1, 'email', 'hX')
    addAllowlistSession(db, 1, 'email', 'hX') // duplicate
    const snap = getAllowlists(db, 1)
    expect(snap.session.size).toBe(1)
    expect(isAllowlisted(snap, 'email', 'hX')).toBe(true)
  })

  it('addAllowlistGlobal is visible from every sessions allow snapshot', () => {
    addAllowlistGlobal(db, 'api-key', 'gK')
    const snap1 = getAllowlists(db, 1)
    const snap2 = getAllowlists(db, 2)
    expect(isAllowlisted(snap1, 'api-key', 'gK')).toBe(true)
    expect(isAllowlisted(snap2, 'api-key', 'gK')).toBe(true)
  })

  it('removeAllowlistSession + removeAllowlistGlobal work', () => {
    addAllowlistSession(db, 1, 'email', 'hX')
    addAllowlistGlobal(db, 'api-key', 'gK')
    removeAllowlistSession(db, 1, 'email', 'hX')
    removeAllowlistGlobal(db, 'api-key', 'gK')
    const snap = getAllowlists(db, 1)
    expect(snap.session.size).toBe(0)
    expect(snap.global.size).toBe(0)
  })
})

describe('repo: dismiss/undismiss flow', () => {
  let db: Database.Database
  beforeEach(() => {
    db = setupDb()
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 14, endOffset: 34, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 50, endOffset: 57, state: 'active' },
    ])
    updateSessionCounts(db, 1)
  })

  it('dismiss session-scope flips state + writes allowlist + updates counts', () => {
    const f = listFindings(db, { kind: 'email' })[0]!
    dismissFinding(db, f.id, 'session')
    const after = db.prepare('SELECT state FROM findings WHERE id = ?').get(f.id) as { state: string }
    expect(after.state).toBe('dismissed')
    const snap = getAllowlists(db, 1)
    expect(snap.session.size).toBe(1)
    expect(snap.global.size).toBe(0)
    const counts = db.prepare('SELECT scan_finding_count, scan_high_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number; scan_high_count: number }
    expect(counts.scan_finding_count).toBe(1)
    expect(counts.scan_high_count).toBe(1)
  })

  it('dismiss global-scope writes to allowlist_global only', () => {
    const f = listFindings(db, { kind: 'api-key' })[0]!
    dismissFinding(db, f.id, 'global')
    const snap = getAllowlists(db, 1)
    expect(snap.session.size).toBe(0)
    expect(snap.global.size).toBe(1)
  })

  it('undismiss flips state back + removes allowlist entries', () => {
    const f = listFindings(db, { kind: 'email' })[0]!
    dismissFinding(db, f.id, 'session')
    undismissFinding(db, f.id)
    const after = db.prepare('SELECT state FROM findings WHERE id = ?').get(f.id) as { state: string }
    expect(after.state).toBe('active')
    const snap = getAllowlists(db, 1)
    expect(snap.session.size).toBe(0)
    const counts = db.prepare('SELECT scan_finding_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number }
    expect(counts.scan_finding_count).toBe(2)
  })
})

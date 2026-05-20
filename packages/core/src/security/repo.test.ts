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
  listSessionsWithFindings,
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
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at)
     VALUES (1, 1, 1, 's-1', '/p/s-1', 'Session 1', '2026-01-01', '2026-01-01'),
            (2, 1, 1, 's-2', '/p/s-2', 'Other Session', '2026-01-02', '2026-01-02')`,
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

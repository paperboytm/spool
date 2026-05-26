import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/db.js'
import { insertFindings, occurrencesByValueHash, dismissFinding, listFindings } from './repo.js'

// Cross-session blast radius: the same leaked value (one kind + one
// value_hash) appearing in multiple sessions across multiple projects.
//
// Layout:
//   project 1 "alpha"  → session 1 (×2 occurrences of HASH)
//                        session 2 (×1 occurrence of HASH)
//   project 2 "beta"   → session 3 (×1 occurrence of HASH)
//   session 4 (alpha)  → a DIFFERENT value (other hash) — must not leak in.
const HASH = 'shared-hash-abc'
const OTHER = 'other-hash-xyz'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'alpha', '/alpha', 'alpha'),
            (2, 1, 'beta',  '/beta',  'beta')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
     VALUES (1, 1, 1, 's-1', '/alpha/s-1', 'Session One',  '2026-01-01', '2026-01-01', 1),
            (2, 1, 1, 's-2', '/alpha/s-2', 'Session Two',  '2026-01-02', '2026-01-02', 1),
            (3, 2, 1, 's-3', '/beta/s-3',  'Session Three','2026-01-03', '2026-01-03', 1),
            (4, 1, 1, 's-4', '/alpha/s-4', 'Session Four', '2026-01-04', '2026-01-04', 1)`,
  ).run()
  db.prepare(
    `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
     VALUES (10, 1, 1, 'user', 'm1', '2026-01-01', 0),
            (20, 2, 1, 'user', 'm2', '2026-01-02', 0),
            (30, 3, 1, 'user', 'm3', '2026-01-03', 0),
            (40, 4, 1, 'user', 'm4', '2026-01-04', 0)`,
  ).run()
  return db
}

describe('occurrencesByValueHash', () => {
  let db: Database.Database
  beforeEach(() => {
    db = setupDb()
    insertFindings(db, [
      // session 1 — two occurrences of the shared value
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: 10, endOffset: 15, state: 'active' },
      // session 2 — one occurrence
      { sessionId: 2, messageId: 20, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
      // session 3 (other project) — one occurrence
      { sessionId: 3, messageId: 30, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
      // session 4 — a DIFFERENT value, same kind
      { sessionId: 4, messageId: 40, kind: 'api-key', valueHash: OTHER, confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
    ])
  })

  it('aggregates per-session counts across all sessions and projects', () => {
    const rows = occurrencesByValueHash(db, 'api-key', HASH)
    expect(rows).toHaveLength(3) // sessions 1, 2, 3 — not 4 (other hash)
    const bySession = new Map(rows.map(r => [r.sessionId, r]))
    expect(bySession.get(1)!.count).toBe(2)
    expect(bySession.get(2)!.count).toBe(1)
    expect(bySession.get(3)!.count).toBe(1)
    expect(bySession.has(4)).toBe(false)
  })

  it('carries project + title + uuid + lastSeen for each session', () => {
    const rows = occurrencesByValueHash(db, 'api-key', HASH)
    const s3 = rows.find(r => r.sessionId === 3)!
    expect(s3.project).toBe('beta')
    expect(s3.sessionTitle).toBe('Session Three')
    expect(s3.sessionUuid).toBe('s-3')
    // source drives the per-row badge so each row reads as a session.
    expect(s3.source).toBe('claude')
    // detected_at is set at insert time (column DEFAULT), so lastSeen is
    // a real timestamp string rather than the seeded session date.
    expect(typeof s3.lastSeen).toBe('string')
    expect(s3.lastSeen.length).toBeGreaterThan(0)
    expect(rows.find(r => r.sessionId === 1)!.project).toBe('alpha')
  })

  it('orders by most-recent detection, with session id as a stable tiebreak', () => {
    // All four findings were inserted in the same tick, so detected_at
    // ties; the id DESC tiebreak makes the order deterministic
    // (newest-inserted session first → 3, 2, 1).
    const rows = occurrencesByValueHash(db, 'api-key', HASH)
    expect(rows.map(r => r.sessionId)).toEqual([3, 2, 1])
  })

  it('counts ONLY active findings — dismissing one drops it from the radius', () => {
    // Dismiss session 2's only occurrence.
    const f2 = listFindings(db, { sessionId: 2 }).find(f => f.valueHash === HASH)!
    dismissFinding(db, f2.id, 'session')
    const rows = occurrencesByValueHash(db, 'api-key', HASH)
    expect(rows.map(r => r.sessionId).sort()).toEqual([1, 3])
    // session 1 still ×2 (untouched).
    expect(rows.find(r => r.sessionId === 1)!.count).toBe(2)
  })

  it('returns [] when no session contains the value', () => {
    expect(occurrencesByValueHash(db, 'api-key', 'nonexistent-hash')).toEqual([])
  })

  it('keys on kind too — a different kind with the same hash is separate', () => {
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'jwt', valueHash: HASH, confidence: 0.9, provider: 'regex', startOffset: 20, endOffset: 25, state: 'active' },
    ])
    // The api-key radius is unchanged (still 3 sessions).
    expect(occurrencesByValueHash(db, 'api-key', HASH)).toHaveLength(3)
    // The jwt radius is just session 1.
    const jwt = occurrencesByValueHash(db, 'jwt', HASH)
    expect(jwt).toHaveLength(1)
    expect(jwt[0]!.sessionId).toBe(1)
  })
})

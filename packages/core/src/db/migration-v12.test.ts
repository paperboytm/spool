import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, LATEST_SCHEMA_VERSION } from './db.js'

const userVersion = (db: Database.Database): number =>
  (db.pragma('user_version') as Array<{ user_version: number }>)[0]!.user_version

function seedProjectAndSession(db: Database.Database, sessionUuid: string): number {
  db.prepare(
    `INSERT OR IGNORE INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (project_id, source_id, session_uuid, file_path, started_at, ended_at)
     VALUES (1, 1, ?, ?, '2026-01-01', '2026-01-01')`,
  ).run(sessionUuid, `/p/${sessionUuid}`)
  return (db.prepare('SELECT id FROM sessions WHERE session_uuid = ?').get(sessionUuid) as { id: number }).id
}

describe('migration v12 — security scan schema', () => {
  it('LATEST_SCHEMA_VERSION reflects the latest migration', () => {
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(12)
  })

  it('adds 5 scan_* columns to sessions (profile / completed_at / finding_count / high_count / purged_count)', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    const names = new Set(cols.map(c => c.name))
    expect(names.has('scan_profile')).toBe(true)
    expect(names.has('scan_completed_at')).toBe(true)
    expect(names.has('scan_finding_count')).toBe(true)
    expect(names.has('scan_high_count')).toBe(true)
    expect(names.has('scan_purged_count')).toBe(true)
  })

  it('counter columns default to 0 and scan_profile defaults to NULL', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    // insert a minimal session through the schema-sanity-honoured shape
    seedProjectAndSession(db, 's')
    const row = db.prepare(
      'SELECT scan_finding_count, scan_high_count, scan_purged_count, scan_profile FROM sessions WHERE session_uuid = ?',
    ).get('s') as { scan_finding_count: number; scan_high_count: number; scan_purged_count: number; scan_profile: string | null }
    expect(row.scan_finding_count).toBe(0)
    expect(row.scan_high_count).toBe(0)
    expect(row.scan_purged_count).toBe(0)
    expect(row.scan_profile).toBeNull()
  })

  it('creates findings table with expected columns and rejects unknown states via CHECK', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const cols = db.prepare('PRAGMA table_info(findings)').all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toEqual(expect.arrayContaining([
      'id', 'session_id', 'message_id', 'kind', 'value_hash', 'confidence',
      'provider', 'start_offset', 'end_offset', 'state', 'detected_at',
      'state_changed_at',
    ]))
    // CHECK constraint should reject unknown state values
    seedProjectAndSession(db, 's')
    expect(() =>
      db.prepare(
        `INSERT INTO findings (session_id, kind, value_hash, confidence, provider, start_offset, end_offset, state)
         VALUES (1,'email','abc',1.0,'regex',0,5,'banana')`,
      ).run(),
    ).toThrow(/CHECK/)
  })

  it('findings.session_id FK cascade deletes findings when a session is removed', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    seedProjectAndSession(db, 's')
    const sessionId = (db.prepare('SELECT id FROM sessions WHERE session_uuid = ?').get('s') as { id: number }).id
    db.prepare(
      `INSERT INTO findings (session_id, kind, value_hash, confidence, provider, start_offset, end_offset)
       VALUES (?,'email','abc',1.0,'regex',0,5)`,
    ).run(sessionId)
    expect((db.prepare('SELECT COUNT(*) AS c FROM findings').get() as { c: number }).c).toBe(1)
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
    expect((db.prepare('SELECT COUNT(*) AS c FROM findings').get() as { c: number }).c).toBe(0)
  })

  it('creates allowlist_session and allowlist_global tables', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('allowlist_session'),
    ).toBeDefined()
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get('allowlist_global'),
    ).toBeDefined()
  })

  it('user_version reaches the latest schema after a clean migration', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  it('migration is idempotent — running twice does not error and stays at the latest schema', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
    expect(userVersion(db)).toBe(LATEST_SCHEMA_VERSION)
  })

  // Regression for the partial-failure case the audit flagged: if
  // v12's SQL block were ever run outside a transaction and the
  // process died mid-way, some ALTER TABLEs would auto-commit, the
  // pragma wouldn't bump, and the next launch's retry would hit a
  // duplicate-column error on the first ALTER. The wrapping
  // `db.transaction(() => …)()` in db.ts is what prevents that;
  // this test enforces the wrapper stays in place by asserting that
  // a forced mid-migration failure rolls everything back atomically.
  it('partial failure inside the v12 SQL block rolls back atomically (transactional safety)', () => {
    const db = new Database(':memory:')
    // Pre-create a `findings` table that conflicts with v12's
    // CREATE TABLE so the migration crashes mid-block. Because v12
    // is wrapped in a transaction, the preceding ALTER TABLEs
    // should roll back and `sessions` should NOT have any scan_*
    // columns after the failed attempt.
    db.exec(`
      CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, base_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO sources (id, name, base_path) VALUES (1, 'claude', '/');
      CREATE TABLE projects (id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id), slug TEXT NOT NULL, display_path TEXT NOT NULL, display_name TEXT NOT NULL, last_synced TEXT, UNIQUE (source_id, slug));
      CREATE TABLE sessions (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id), source_id INTEGER NOT NULL REFERENCES sources(id), session_uuid TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE, title TEXT, title_source TEXT NOT NULL DEFAULT 'derived', started_at TEXT NOT NULL, ended_at TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0, has_tool_use INTEGER NOT NULL DEFAULT 0, cwd TEXT, model TEXT, raw_file_mtime TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE findings (id INTEGER PRIMARY KEY, conflict_column TEXT);
    `)
    db.pragma('user_version = 11')

    expect(() => runMigrations(db)).toThrow()
    // The transaction wrapper should have reverted everything.
    expect(userVersion(db)).toBeLessThan(12)
    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    const names = new Set(cols.map(c => c.name))
    expect(names.has('scan_profile'), 'scan_profile should have been rolled back').toBe(false)
    expect(names.has('scan_purged_count'), 'scan_purged_count should have been rolled back').toBe(false)
  })
})

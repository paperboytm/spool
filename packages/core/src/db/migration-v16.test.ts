import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import { LATEST_SCHEMA_VERSION, runMigrations } from './db.js'

describe('migration v16: parent session relationships', () => {
  it('adds the parent column and index to a v15 database', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    db.exec('DROP INDEX idx_sessions_parent')
    db.pragma('user_version = 15')

    // SQLite cannot drop a column safely across every supported runtime, so
    // simulate the v15 shape in a fresh attached table and swap it into place.
    db.exec(`
      ALTER TABLE sessions RENAME TO sessions_v16;
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id),
        source_id INTEGER NOT NULL REFERENCES sources(id),
        session_uuid TEXT NOT NULL UNIQUE,
        file_path TEXT NOT NULL UNIQUE,
        title TEXT,
        title_source TEXT NOT NULL DEFAULT 'derived',
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        message_count INTEGER NOT NULL DEFAULT 0,
        has_tool_use INTEGER NOT NULL DEFAULT 0,
        cwd TEXT,
        model TEXT,
        raw_file_mtime TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        scan_profile TEXT,
        scan_completed_at TEXT,
        scan_finding_count INTEGER NOT NULL DEFAULT 0,
        scan_high_count INTEGER NOT NULL DEFAULT 0,
        scan_purged_count INTEGER NOT NULL DEFAULT 0
      );
      DROP TABLE sessions_v16;
    `)

    runMigrations(db)

    const columns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('parent_session_uuid')
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sessions'")
      .all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('idx_sessions_parent')
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version).toBe(
      LATEST_SCHEMA_VERSION,
    )
  })
})

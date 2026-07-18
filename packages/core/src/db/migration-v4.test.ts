import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { runMigrations } from './db.js'

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

/**
 * Seed a v3 DB: post-v3 schema (connector tables present + last_error_at on
 * connector_sync_state, no stars table yet). v4 should create the wide-CHECK
 * stars table; v5 then narrows it; v7 drops it for pins.
 */
function seedV3(dbPath: string) {
  const seed = new Database(dbPath)
  seed.pragma('journal_mode = WAL')
  seed.pragma('foreign_keys = ON')
  seed.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sources (name, base_path) VALUES
      ('claude','~/.claude/projects'),('codex','~/.codex/sessions'),
      ('gemini','~/.gemini/tmp'),('connector','<plugin>');

    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
      slug TEXT NOT NULL, display_path TEXT NOT NULL, display_name TEXT NOT NULL,
      last_synced TEXT, UNIQUE (source_id, slug)
    );
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      source_id INTEGER NOT NULL REFERENCES sources(id),
      session_uuid TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE,
      title TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0, has_tool_use INTEGER NOT NULL DEFAULT 0,
      cwd TEXT, model TEXT, raw_file_mtime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      msg_uuid TEXT, parent_uuid TEXT, role TEXT NOT NULL,
      content_text TEXT NOT NULL DEFAULT '', timestamp TEXT NOT NULL,
      is_sidechain INTEGER NOT NULL DEFAULT 0, tool_names TEXT NOT NULL DEFAULT '[]',
      seq INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE messages_fts USING fts5(content_text, content='messages', content_rowid='id');
    CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(content_text, content='messages', content_rowid='id', tokenize='trigram');
    CREATE TABLE sync_log (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
      file_path TEXT NOT NULL, status TEXT NOT NULL, message TEXT,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE session_search (
      session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '', user_text TEXT NOT NULL DEFAULT '',
      assistant_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE session_search_fts USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id');
    CREATE VIRTUAL TABLE session_search_fts_trigram USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id', tokenize='trigram');

    CREATE TABLE captures (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
      capture_uuid TEXT NOT NULL UNIQUE, url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', content_text TEXT NOT NULL DEFAULT '',
      author TEXT, platform TEXT NOT NULL, platform_id TEXT,
      content_type TEXT NOT NULL DEFAULT 'page', thumbnail_url TEXT,
      metadata TEXT NOT NULL DEFAULT '{}', captured_at TEXT NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now')), raw_json TEXT
    );
    CREATE VIRTUAL TABLE captures_fts USING fts5(title, content_text, content='captures', content_rowid='id');
    CREATE VIRTUAL TABLE captures_fts_trigram USING fts5(title, content_text, content='captures', content_rowid='id', tokenize='trigram');
    CREATE TABLE capture_connectors (
      capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
      connector_id TEXT NOT NULL, PRIMARY KEY (capture_id, connector_id)
    );
    CREATE TABLE connector_sync_state (
      connector_id TEXT PRIMARY KEY, head_cursor TEXT, head_item_id TEXT,
      tail_cursor TEXT, tail_complete INTEGER NOT NULL DEFAULT 0,
      last_forward_sync_at TEXT, last_backfill_sync_at TEXT,
      total_synced INTEGER NOT NULL DEFAULT 0, consecutive_errors INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}',
      last_error_at TEXT
    );
  `)

  seed
    .prepare(
      "INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1, 'p', '/p', 'p')",
    )
    .run()
  seed
    .prepare(`
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
    VALUES (1, 1, 'sess-uuid', '/fake/sess.jsonl', 'A session', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1)
  `)
    .run()

  seed.pragma('user_version = 3')
  seed.close()
}

describe('migration v4 (introduce stars table)', () => {
  it('migrates a v3 DB cleanly through head: stars created in v4, dropped in v7, pins empty', () => {
    const dir = makeTempDir('spool-v4-mig-')
    const dbPath = join(dir, 'spool.db')
    seedV3(dbPath)

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    expect(() => runMigrations(db)).not.toThrow()

    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version
    expect(v).toBeGreaterThanOrEqual(7)

    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
      ).map((r) => r.name),
    )
    expect(tables.has('stars')).toBe(false) // dropped by v7
    expect(tables.has('pins')).toBe(true)

    // v3 DB had no stars to migrate, so pins is empty
    const pinCount = db.prepare('SELECT COUNT(*) AS c FROM pins').get() as { c: number }
    expect(pinCount.c).toBe(0)

    db.close()
  })

  it('drops a legacy session_stars table if one is present', () => {
    // v4 migration begins with `DROP TABLE IF EXISTS session_stars`. Verify
    // that pre-v4 schemas which somehow had a session_stars table get cleaned up.
    const dir = makeTempDir('spool-v4-legacy-')
    const dbPath = join(dir, 'spool.db')
    seedV3(dbPath)

    const seed = new Database(dbPath)
    seed.exec(`CREATE TABLE session_stars (session_uuid TEXT PRIMARY KEY)`)
    seed.prepare(`INSERT INTO session_stars (session_uuid) VALUES ('legacy-uuid')`).run()
    seed.close()

    const db = new Database(dbPath)
    runMigrations(db)

    const tables = new Set(
      (
        db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
      ).map((r) => r.name),
    )
    expect(tables.has('session_stars')).toBe(false)

    db.close()
  })
})

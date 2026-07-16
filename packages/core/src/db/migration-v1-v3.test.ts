import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
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
 * Build a DB with the FULL pre-v1 schema (connector_sync_state without
 * last_error_at, captures with connectorId in metadata, captures_fts populated
 * but FTS empty so v2 has work to do, capture_connectors empty so v3 has work
 * to do) and exercise the entire v1→v7 path.
 *
 * Goal: prove v1-v3 don't break the chain on a populated historical DB.
 * v5 erases all connector tables, so end-state is the post-v7 schema. The
 * value is in *getting there* without throwing.
 */
function seedV0(dbPath: string) {
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
    -- Pre-v1: connector_sync_state WITHOUT last_error_at
    CREATE TABLE connector_sync_state (
      connector_id TEXT PRIMARY KEY, head_cursor TEXT, head_item_id TEXT,
      tail_cursor TEXT, tail_complete INTEGER NOT NULL DEFAULT 0,
      last_forward_sync_at TEXT, last_backfill_sync_at TEXT,
      total_synced INTEGER NOT NULL DEFAULT 0, consecutive_errors INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}'
    );
  `)

  seed.prepare("INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1, 'p', '/p', 'p')").run()
  seed.prepare(`
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
    VALUES (1, 1, 'sess-uuid', '/fake/sess.jsonl', 'A session', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1)
  `).run()
  // v3 fixture: capture with connectorId in metadata (not yet promoted to capture_connectors)
  seed.prepare(`
    INSERT INTO captures (source_id, capture_uuid, url, title, content_text, platform, captured_at, metadata)
    VALUES (4, 'cap-uuid', 'https://x.com/1', 'A tweet', 'tweet text', 'twitter', '2026-01-01T00:00:00Z',
      '{"connectorId":"twitter-bookmarks","extra":"keep"}')
  `).run()
  seed.prepare("INSERT INTO connector_sync_state (connector_id) VALUES ('twitter-bookmarks')").run()

  seed.pragma('user_version = 0')
  seed.close()
}

describe('migration v1-v3 (historical connector path)', () => {
  it('migrates a populated v0 DB cleanly to head without errors', () => {
    const dir = makeTempDir('spool-v0-mig-')
    const dbPath = join(dir, 'spool.db')
    seedV0(dbPath)

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    expect(() => runMigrations(db)).not.toThrow()

    // Reached head version
    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version
    expect(v).toBeGreaterThanOrEqual(7)

    // Connector tables erased by v5
    const tableNames = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
        .map(r => r.name),
    )
    expect(tableNames.has('captures')).toBe(false)
    expect(tableNames.has('capture_connectors')).toBe(false)
    expect(tableNames.has('connector_sync_state')).toBe(false)

    // 'connector' source row dropped by v5
    const sources = (db.prepare('SELECT name FROM sources').all() as { name: string }[]).map(s => s.name)
    expect(sources.sort()).toEqual(['antigravity', 'claude', 'codex', 'gemini', 'opencode'])

    // Session preserved
    const sess = db.prepare("SELECT session_uuid FROM sessions WHERE session_uuid='sess-uuid'").get() as { session_uuid: string }
    expect(sess.session_uuid).toBe('sess-uuid')

    db.close()
  })

  it('runs cleanly on a fresh DB where the historical connector tables never existed', () => {
    // This is the post-v5 fresh-install path: runMigrations CREATEs the
    // current schema (no captures/connector_sync_state), then walks v1-v7.
    // v1-v3 must be no-ops without throwing.
    const db = new Database(':memory:')
    expect(() => runMigrations(db)).not.toThrow()

    const v = (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version
    expect(v).toBeGreaterThanOrEqual(7)

    db.close()
  })

  it('does not leave behind connector tables on a fresh DB', () => {
    const db = new Database(':memory:')
    runMigrations(db)
    const names = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[])
        .map(r => r.name),
    )
    expect(names.has('captures')).toBe(false)
    expect(names.has('captures_fts')).toBe(false)
    expect(names.has('capture_connectors')).toBe(false)
    expect(names.has('connector_sync_state')).toBe(false)
    db.close()
  })
})

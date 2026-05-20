import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'

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
 * Build a DB at user_version=4 with the historical schema (captures,
 * connector_sync_state, capture_connectors, wide stars CHECK) and pre-existing
 * capture/session data, then load it through the post-v5 getDB() and verify
 * the migration drops all connector tables, narrows the stars CHECK, and
 * preserves session stars.
 */
describe('migration v5 (connector subsystem removal)', () => {
  it('drops connector tables, narrows stars CHECK, deletes capture stars, preserves session stars', async () => {
    const spoolDir = makeTempDir('spool-v5-mig-')
    const dbPath = join(spoolDir, 'spool.db')

    // ── Seed a v4 DB by hand ──────────────────────────────────────────────
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

      -- The historical connector tables that v5 must drop:
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
        last_error_at TEXT, last_error_code TEXT, last_error_message TEXT
      );

      -- v4 wide-CHECK stars:
      CREATE TABLE stars (
        item_type  TEXT NOT NULL CHECK (item_type IN ('session', 'capture')),
        item_uuid  TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_type, item_uuid)
      );
    `)

    // Seed a session, a capture, and one star of each kind
    seed.prepare("INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1, 'p', '/p', 'p')").run()
    seed.prepare(`
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
      VALUES (1, 1, 'sess-uuid', '/fake/sess.jsonl', 'A session', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1)
    `).run()
    seed.prepare(`
      INSERT INTO captures (source_id, capture_uuid, url, title, platform, captured_at)
      VALUES (4, 'cap-uuid', 'https://x.com/1', 'A tweet', 'twitter', '2026-01-01T00:00:00Z')
    `).run()
    seed.prepare("INSERT INTO capture_connectors (capture_id, connector_id) VALUES (1, 'twitter-bookmarks')").run()
    seed.prepare("INSERT INTO connector_sync_state (connector_id) VALUES ('twitter-bookmarks')").run()

    seed.prepare("INSERT INTO stars (item_type, item_uuid) VALUES ('session', 'sess-uuid')").run()
    seed.prepare("INSERT INTO stars (item_type, item_uuid) VALUES ('capture', 'cap-uuid')").run()

    seed.pragma('user_version = 4')
    seed.close()

    // ── Run the post-v5 getDB() against this seeded DB ────────────────────
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    // Upgrade-path detection: DB pre-existed and was on v4
    expect(dbModule.wasNewDb()).toBe(false)
    expect(dbModule.getInitialUserVersion()).toBe(4)

    // user_version bumped past 5 (current head is 6)
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version).toBeGreaterThanOrEqual(5)

    // Connector tables and FTS gone
    const tablesAfter = db.prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'").all() as Array<{ name: string }>
    const tableNames = new Set(tablesAfter.map(r => r.name))
    expect(tableNames.has('captures')).toBe(false)
    expect(tableNames.has('captures_fts')).toBe(false)
    expect(tableNames.has('captures_fts_trigram')).toBe(false)
    expect(tableNames.has('capture_connectors')).toBe(false)
    expect(tableNames.has('connector_sync_state')).toBe(false)

    // 'connector' source row also dropped
    const sources = db.prepare('SELECT name FROM sources').all() as Array<{ name: string }>
    expect(sources.map(s => s.name).sort()).toEqual(['claude', 'codex', 'gemini', 'opencode'])

    // After v7: stars dropped, session star preserved as pin, capture star gone
    expect(tableNames.has('stars')).toBe(false)
    expect(tableNames.has('pins')).toBe(true)
    const pins = db.prepare('SELECT session_uuid FROM pins').all()
    expect(pins).toEqual([{ session_uuid: 'sess-uuid' }])

    // Session itself still there
    const sess = db.prepare("SELECT session_uuid FROM sessions WHERE session_uuid='sess-uuid'").get() as { session_uuid: string }
    expect(sess.session_uuid).toBe('sess-uuid')

    db.close()
  })

  it('is a no-op on a fresh install (no connector tables to drop)', async () => {
    const spoolDir = makeTempDir('spool-v5-fresh-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    // Upgrade-path detection: DB file did not exist before this run
    expect(dbModule.wasNewDb()).toBe(true)
    expect(dbModule.getInitialUserVersion()).toBe(0)

    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version).toBeGreaterThanOrEqual(7)

    // Fresh install lands on v7 schema: pins exists, stars dropped
    db.prepare('INSERT INTO pins (session_uuid) VALUES (?)').run('x')
    expect(db.prepare('SELECT COUNT(*) AS c FROM pins').get()).toEqual({ c: 1 })

    db.close()
  })
})

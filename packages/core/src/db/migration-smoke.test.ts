import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

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
 * End-to-end smoke: simulate the real getDB() entry point that the app and
 * CLI use, for both fresh installs and every historically-released DB
 * version, then exercise the resulting DB through the public query API.
 *
 * The intent is to prove neither new users nor old users crash during
 * migration AND that the migrated DB is functionally usable afterwards.
 */

async function loadGetDB(spoolDir: string) {
  vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
  vi.resetModules()
  return await import('./db.js')
}

function exerciseDb(db: Database.Database, sessionUuid: string) {
  // Insert a new session through the post-migration schema
  const sourceId = (
    db.prepare(`SELECT id FROM sources WHERE name = 'claude'`).get() as { id: number }
  ).id
  const projectId = Number(
    db
      .prepare(
        `INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sourceId, `slug-${sessionUuid}`, '/smoke/p', 'p', 'path', '/smoke/p').lastInsertRowid,
  )
  db.prepare(`
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
    VALUES (?, ?, ?, ?, 'smoke', '2026-04-30T00:00:00Z', '2026-04-30T00:01:00Z', 0)
  `).run(projectId, sourceId, sessionUuid, `/smoke/${sessionUuid}.jsonl`)

  // Pin + verify (uses the post-v7 pins table)
  db.prepare(`INSERT INTO pins (session_uuid) VALUES (?)`).run(sessionUuid)
  const pinned = db.prepare(`SELECT session_uuid FROM pins WHERE session_uuid = ?`).get(sessionUuid)
  expect(pinned).toEqual({ session_uuid: sessionUuid })

  // The post-v6 view exists and responds
  const view = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='view' AND name='project_groups_v'`)
    .get()
  expect(view).toBeDefined()
}

function seedV0(dbPath: string) {
  const seed = new Database(dbPath)
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
      enabled INTEGER NOT NULL DEFAULT 1, config_json TEXT NOT NULL DEFAULT '{}'
    );
  `)

  // Pre-existing user data: a session and a capture with connectorId metadata
  // so v1, v2, v3 all have something to do.
  seed
    .prepare(
      "INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1, 'p', '/p', 'p')",
    )
    .run()
  seed
    .prepare(`
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
    VALUES (1, 1, 'old-sess', '/old/sess.jsonl', 'old', '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', 1)
  `)
    .run()
  seed
    .prepare(`
    INSERT INTO captures (source_id, capture_uuid, url, title, content_text, platform, captured_at, metadata)
    VALUES (4, 'c1', 'https://x.com/1', 'A tweet', 'tweet text', 'twitter', '2026-01-01T00:00:00Z',
      '{"connectorId":"twitter-bookmarks"}')
  `)
    .run()
  seed.prepare("INSERT INTO connector_sync_state (connector_id) VALUES ('twitter-bookmarks')").run()
  seed.pragma('user_version = 0')
  seed.close()
}

function seedV4WithStars(dbPath: string) {
  // v4 schema with both kinds of stars (session + capture). v5 should
  // preserve the session star (later promoted to a pin in v7) and drop
  // the capture star.
  seedV0(dbPath)
  const upgrade = new Database(dbPath)
  upgrade.exec(`
    ALTER TABLE connector_sync_state ADD COLUMN last_error_at TEXT;
    CREATE TABLE stars (
      item_type  TEXT NOT NULL CHECK (item_type IN ('session', 'capture')),
      item_uuid  TEXT NOT NULL,
      starred_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_type, item_uuid)
    );
    INSERT INTO stars (item_type, item_uuid, starred_at)
      VALUES ('session','old-sess','2026-03-15 12:00:00'),
             ('capture','c1','2026-03-15 12:00:00');
  `)
  upgrade.pragma('user_version = 4')
  upgrade.close()
}

function seedV6(dbPath: string) {
  // post-v6 schema: stars (narrow CHECK) still exists; identity columns
  // present on projects.
  const seed = new Database(dbPath)
  seed.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, base_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sources (name, base_path) VALUES
      ('claude','~/.claude/projects'),('codex','~/.codex/sessions'),('gemini','~/.gemini/tmp');
    CREATE TABLE projects (
      id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL REFERENCES sources(id),
      slug TEXT NOT NULL, display_path TEXT NOT NULL, display_name TEXT NOT NULL,
      identity_kind TEXT, identity_key TEXT, last_synced TEXT,
      UNIQUE (source_id, slug)
    );
    INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES (1, 'p', '/p', 'p', 'path', '/p');
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id),
      source_id INTEGER NOT NULL REFERENCES sources(id),
      session_uuid TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE,
      title TEXT, started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0, has_tool_use INTEGER NOT NULL DEFAULT 0,
      cwd TEXT, model TEXT, raw_file_mtime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at)
      VALUES (1, 1, 'v6-sess', '/v6/s.jsonl', 't', '2026-04-01', '2026-04-01');
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
    CREATE TABLE sync_log (id INTEGER PRIMARY KEY, source_id INTEGER, file_path TEXT, status TEXT, message TEXT, synced_at TEXT);
    CREATE TABLE session_search (
      session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '', user_text TEXT NOT NULL DEFAULT '',
      assistant_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE session_search_fts USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id');
    CREATE VIRTUAL TABLE session_search_fts_trigram USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id', tokenize='trigram');
    CREATE TABLE stars (
      item_type  TEXT NOT NULL CHECK (item_type = 'session'),
      item_uuid  TEXT NOT NULL,
      starred_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (item_type, item_uuid)
    );
    INSERT INTO stars (item_type, item_uuid, starred_at)
      VALUES ('session', 'v6-sess', '2026-04-15 09:00:00');
    CREATE VIEW project_groups_v AS
      SELECT identity_kind, identity_key, MIN(display_name) AS display_name,
             '' AS sources_csv, 0 AS session_count, NULL AS last_session_at
      FROM projects WHERE identity_kind IS NOT NULL
      GROUP BY identity_kind, identity_key;
  `)
  seed.pragma('user_version = 6')
  seed.close()
}

describe('migration smoke (full path through getDB)', () => {
  it('new user: fresh install lands at head and DB is functional', async () => {
    const spoolDir = makeTempDir('spool-smoke-fresh-')
    const dbModule = await loadGetDB(spoolDir)
    const db = dbModule.getDB()

    expect(dbModule.wasNewDb()).toBe(true)
    expect(dbModule.getInitialUserVersion()).toBe(0)
    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version,
    ).toBeGreaterThanOrEqual(7)

    exerciseDb(db, 'fresh-uuid')
    db.close()
  })

  it('old user (v0): full historical schema with capture+session data migrates and DB is functional', async () => {
    const spoolDir = makeTempDir('spool-smoke-v0-')
    seedV0(join(spoolDir, 'spool.db'))

    const dbModule = await loadGetDB(spoolDir)
    const db = dbModule.getDB()

    expect(dbModule.wasNewDb()).toBe(false)
    expect(dbModule.getInitialUserVersion()).toBe(0)
    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version,
    ).toBeGreaterThanOrEqual(7)

    // Old session preserved
    const oldSess = db
      .prepare(`SELECT session_uuid FROM sessions WHERE session_uuid='old-sess'`)
      .get()
    expect(oldSess).toEqual({ session_uuid: 'old-sess' })

    // New session/pin still works post-migration
    exerciseDb(db, 'v0-newuser')
    db.close()
  })

  it('old user (v4 with starred session + capture): session pin survives, capture star dropped, DB functional', async () => {
    const spoolDir = makeTempDir('spool-smoke-v4-')
    seedV4WithStars(join(spoolDir, 'spool.db'))

    const dbModule = await loadGetDB(spoolDir)
    const db = dbModule.getDB()

    expect(dbModule.getInitialUserVersion()).toBe(4)

    // v5 narrows stars CHECK + drops captures (and capture star);
    // v7 promotes session star to pin.
    const pins = db.prepare(`SELECT session_uuid FROM pins ORDER BY session_uuid`).all()
    expect(pins).toEqual([{ session_uuid: 'old-sess' }])

    exerciseDb(db, 'v4-newuser')
    db.close()
  })

  it('old user (v6 with starred session): star migrates to pin and DB is functional', async () => {
    const spoolDir = makeTempDir('spool-smoke-v6-')
    seedV6(join(spoolDir, 'spool.db'))

    const dbModule = await loadGetDB(spoolDir)
    const db = dbModule.getDB()

    expect(dbModule.getInitialUserVersion()).toBe(6)
    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0].user_version,
    ).toBeGreaterThanOrEqual(7)

    const pins = db.prepare(`SELECT session_uuid, pinned_at FROM pins`).all()
    expect(pins).toEqual([{ session_uuid: 'v6-sess', pinned_at: '2026-04-15 09:00:00' }])

    exerciseDb(db, 'v6-newuser')
    db.close()
  })

  it('idempotent: re-opening an already-migrated DB is a no-op', async () => {
    const spoolDir = makeTempDir('spool-smoke-reopen-')

    // First open: fresh install, runs full migration
    const m1 = await loadGetDB(spoolDir)
    const db1 = m1.getDB()
    db1.close()

    // Second open: DB exists, already at head, should not re-run anything
    vi.resetModules()
    const m2 = await loadGetDB(spoolDir)
    const db2 = m2.getDB()
    expect(m2.wasNewDb()).toBe(false)
    expect(m2.getInitialUserVersion()).toBeGreaterThanOrEqual(7)
    expect(
      (db2.pragma('user_version') as Array<{ user_version: number }>)[0].user_version,
    ).toBeGreaterThanOrEqual(7)
    exerciseDb(db2, 'reopen-uuid')
    db2.close()
  })
})

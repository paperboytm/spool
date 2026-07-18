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

describe('migration v7 (stars → pins)', () => {
  it('migrates session stars to pins and drops the stars table', async () => {
    const spoolDir = makeTempDir('spool-v7-mig-')
    const dbPath = join(spoolDir, 'spool.db')

    // Seed a v6 DB by hand (post-v5 schema with narrow stars CHECK + identity columns)
    const seed = new Database(dbPath)
    seed.pragma('journal_mode = WAL')
    seed.pragma('foreign_keys = ON')
    seed.exec(`
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        base_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO sources (name, base_path) VALUES
        ('claude','~/.claude/projects'),('codex','~/.codex/sessions'),('gemini','~/.gemini/tmp');

      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, source_id INTEGER NOT NULL,
        slug TEXT NOT NULL, display_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        identity_kind TEXT,
        identity_key TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
        VALUES (1,'p','/fake/p','p','path','/fake/p');

      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY,
        project_id INTEGER NOT NULL,
        source_id INTEGER NOT NULL,
        session_uuid TEXT NOT NULL UNIQUE,
        file_path TEXT,
        title TEXT,
        started_at TEXT,
        ended_at TEXT,
        message_count INTEGER,
        has_tool_use INTEGER,
        cwd TEXT,
        model TEXT,
        raw_file_mtime TEXT
      );
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime)
        VALUES (1,1,'sess-a','/p/a','t','2026-01-01','2026-01-01',1,0,'2026-01-01'),
               (1,1,'sess-b','/p/b','t','2026-01-02','2026-01-02',1,0,'2026-01-02');

      CREATE TABLE stars (
        item_type  TEXT NOT NULL CHECK (item_type = 'session'),
        item_uuid  TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_type, item_uuid)
      );
      INSERT INTO stars (item_type, item_uuid, starred_at) VALUES
        ('session','sess-a','2026-03-01 00:00:00'),
        ('session','sess-b','2026-03-02 00:00:00');
    `)
    seed.pragma('user_version = 6')
    seed.close()

    // Run migrations
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version,
    ).toBeGreaterThanOrEqual(7)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string
    }>
    const tableNames = new Set(tables.map((r) => r.name))
    expect(tableNames.has('stars')).toBe(false)
    expect(tableNames.has('pins')).toBe(true)

    const pins = db.prepare('SELECT session_uuid, pinned_at FROM pins ORDER BY session_uuid').all()
    expect(pins).toEqual([
      { session_uuid: 'sess-a', pinned_at: '2026-03-01 00:00:00' },
      { session_uuid: 'sess-b', pinned_at: '2026-03-02 00:00:00' },
    ])

    db.close()
  })

  it('is a no-op on a fresh install (creates empty pins, no stars)', async () => {
    const spoolDir = makeTempDir('spool-v7-fresh-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    expect(dbModule.wasNewDb()).toBe(true)
    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version,
    ).toBeGreaterThanOrEqual(7)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
      name: string
    }>
    const tableNames = new Set(tables.map((r) => r.name))
    expect(tableNames.has('pins')).toBe(true)
    expect(tableNames.has('stars')).toBe(false)

    expect(db.prepare('SELECT COUNT(*) AS c FROM pins').get()).toEqual({ c: 0 })
    db.close()
  })
})

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

function seedV7(dbPath: string): void {
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
      identity_kind TEXT, identity_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO projects (source_id, slug, display_path, display_name, identity_kind, identity_key)
      VALUES (1,'p','/fake/p','p','path','/fake/p');

    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      source_id INTEGER NOT NULL,
      session_uuid TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      has_tool_use INTEGER NOT NULL DEFAULT 0,
      cwd TEXT, model TEXT, raw_file_mtime TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count, has_tool_use, raw_file_mtime)
      VALUES (1,1,'sess-a','/p/a','old title','2026-01-01','2026-01-01',1,0,'2026-01-01');

    CREATE TABLE pins (
      session_uuid TEXT PRIMARY KEY,
      pinned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)
  seed.pragma('user_version = 7')
  seed.close()
}

describe('migration v8 (title_source column)', () => {
  it('adds title_source column with default "derived" when upgrading from v7', async () => {
    const spoolDir = makeTempDir('spool-v8-mig-')
    const dbPath = join(spoolDir, 'spool.db')
    seedV7(dbPath)

    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version,
    ).toBeGreaterThanOrEqual(8)

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('title_source')

    const row = db
      .prepare('SELECT title, title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-a') as { title: string; title_source: string }
    expect(row.title).toBe('old title')
    expect(row.title_source).toBe('derived')

    db.close()
  })

  it('is idempotent when column already exists at v8', async () => {
    const spoolDir = makeTempDir('spool-v8-idem-')
    const dbPath = join(spoolDir, 'spool.db')
    seedV7(dbPath)

    // Pre-add the column and bump user_version, simulating a DB that ran an
    // earlier experimental v8 migration before this canonical one shipped.
    const seed = new Database(dbPath)
    seed.exec(`ALTER TABLE sessions ADD COLUMN title_source TEXT NOT NULL DEFAULT 'derived'`)
    seed.exec(`UPDATE sessions SET title_source = 'spool' WHERE session_uuid = 'sess-a'`)
    seed.pragma('user_version = 8')
    seed.close()

    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    // Existing user-set title_source must survive
    const row = db
      .prepare('SELECT title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-a') as { title_source: string }
    expect(row.title_source).toBe('spool')

    db.close()
  })

  it('repairs DBs where user_version was bumped to 8 but title_source column is missing', async () => {
    // Simulates a DB that ran experimental code which bumped user_version to 8
    // but never ran the column-add (or crashed mid-migration). The version
    // guard alone would skip the ALTER and leave the schema broken; the
    // unconditional schema-sanity check at the end of runMigrations repairs it.
    const spoolDir = makeTempDir('spool-v8-repair-')
    const dbPath = join(spoolDir, 'spool.db')
    seedV7(dbPath)
    const seed = new Database(dbPath)
    seed.pragma('user_version = 8') // bump but don't add the column
    seed.close()

    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    expect(cols.map((c) => c.name)).toContain('title_source')

    const row = db
      .prepare('SELECT title_source FROM sessions WHERE session_uuid = ?')
      .get('sess-a') as { title_source: string }
    expect(row.title_source).toBe('derived')

    db.close()
  })

  it('fresh install creates sessions table with title_source column', async () => {
    const spoolDir = makeTempDir('spool-v8-fresh-')
    vi.stubEnv('SPOOL_DATA_DIR', spoolDir)
    vi.resetModules()
    const dbModule = await import('./db.js')
    const db = dbModule.getDB()

    expect(dbModule.wasNewDb()).toBe(true)
    expect(
      (db.pragma('user_version') as Array<{ user_version: number }>)[0]?.user_version,
    ).toBeGreaterThanOrEqual(8)

    const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{
      name: string
      dflt_value: string | null
      notnull: number
    }>
    const titleSource = cols.find((c) => c.name === 'title_source')
    expect(titleSource).toBeDefined()
    expect(titleSource?.notnull).toBe(1)
    expect(titleSource?.dflt_value).toBe(`'derived'`)

    db.close()
  })
})

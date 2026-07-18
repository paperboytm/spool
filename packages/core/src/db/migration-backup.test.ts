import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { backupBeforeDestructive, runMigrations } from './db.js'

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

function seedDataDb(dbPath: string) {
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE,
      base_path TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO sources (name, base_path) VALUES ('claude','~/.claude/projects');
    CREATE TABLE projects (id INTEGER PRIMARY KEY, source_id INTEGER, slug TEXT, display_path TEXT, display_name TEXT);
    INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1,'p','/p','p');
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY, project_id INTEGER, source_id INTEGER,
      session_uuid TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL UNIQUE,
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL
    );
    INSERT INTO sessions (project_id, source_id, session_uuid, file_path, started_at, ended_at)
      VALUES (1,1,'sess-1','/fake/1.jsonl','2026-01-01','2026-01-01');
  `)
  db.close()
}

describe('backupBeforeDestructive', () => {
  it('writes a VACUUM INTO snapshot to <dbDir>/backups for a populated file DB', () => {
    const dir = makeTempDir('spool-backup-')
    const dbPath = join(dir, 'spool.db')
    seedDataDb(dbPath)

    const db = new Database(dbPath)
    const result = backupBeforeDestructive(db, 4)
    db.close()

    expect(result).not.toBeNull()
    expect(result!.startsWith(join(dir, 'backups'))).toBe(true)
    expect(result!).toMatch(/spool-pre-v5-.*\.db$/)
    expect(statSync(result!).size).toBeGreaterThan(0)

    // Backup is a valid SQLite DB containing the seeded session
    const backupDb = new Database(result!, { readonly: true })
    const row = backupDb.prepare(`SELECT session_uuid FROM sessions`).get() as {
      session_uuid: string
    }
    expect(row.session_uuid).toBe('sess-1')
    backupDb.close()
  })

  it('encodes the source version in the filename (pre-v{N+1})', () => {
    const dir = makeTempDir('spool-backup-vers-')
    const dbPath = join(dir, 'spool.db')
    seedDataDb(dbPath)

    const db = new Database(dbPath)
    const v5 = backupBeforeDestructive(db, 4) // pre-v5
    const v7 = backupBeforeDestructive(db, 6) // pre-v7
    db.close()

    expect(v5!).toMatch(/spool-pre-v5-/)
    expect(v7!).toMatch(/spool-pre-v7-/)
    expect(v5).not.toBe(v7)

    const files = readdirSync(join(dir, 'backups'))
    expect(files.length).toBe(2)
  })

  it('returns null and writes nothing for an in-memory DB', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sessions (session_uuid TEXT)`)
    db.prepare(`INSERT INTO sessions VALUES ('x')`).run()
    const result = backupBeforeDestructive(db, 4)
    expect(result).toBeNull()
    db.close()
  })

  it('returns null and writes nothing when the DB has no session data', () => {
    const dir = makeTempDir('spool-backup-empty-')
    const dbPath = join(dir, 'spool.db')
    const seed = new Database(dbPath)
    seed.exec(`CREATE TABLE sessions (session_uuid TEXT)`)
    seed.close()

    const db = new Database(dbPath)
    const result = backupBeforeDestructive(db, 4)
    db.close()

    expect(result).toBeNull()
    // backups dir is not created when there's nothing to back up
    let backupsExisted = true
    try {
      readdirSync(join(dir, 'backups'))
    } catch {
      backupsExisted = false
    }
    expect(backupsExisted).toBe(false)
  })
})

describe('migration backup integration', () => {
  it('writes a pre-v5 backup when migrating a populated v4 DB through head', () => {
    // Seed a v4 DB with session data, then run migrations and check that
    // a backups/spool-pre-v5-*.db file was written by the v5 destructive step.
    const dir = makeTempDir('spool-mig-backup-v5-')
    const dbPath = join(dir, 'spool.db')
    const seed = new Database(dbPath)
    seed.pragma('journal_mode = WAL')
    seed.exec(`
      CREATE TABLE sources (id INTEGER PRIMARY KEY, name TEXT UNIQUE, base_path TEXT, created_at TEXT);
      INSERT INTO sources (name, base_path) VALUES ('claude','~/.claude');
      CREATE TABLE projects (id INTEGER PRIMARY KEY, source_id INTEGER, slug TEXT, display_path TEXT, display_name TEXT, last_synced TEXT);
      INSERT INTO projects (source_id, slug, display_path, display_name) VALUES (1,'p','/p','p');
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY, project_id INTEGER, source_id INTEGER,
        session_uuid TEXT UNIQUE, file_path TEXT UNIQUE,
        started_at TEXT, ended_at TEXT, message_count INTEGER DEFAULT 0
      );
      INSERT INTO sessions (project_id, source_id, session_uuid, file_path, started_at, ended_at)
        VALUES (1,1,'sess-survive','/fake/s.jsonl','2026-01-01','2026-01-01');
      CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id INTEGER, source_id INTEGER, role TEXT, content_text TEXT, timestamp TEXT, is_sidechain INTEGER DEFAULT 0, tool_names TEXT DEFAULT '[]', seq INTEGER);
      CREATE VIRTUAL TABLE messages_fts USING fts5(content_text, content='messages', content_rowid='id');
      CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(content_text, content='messages', content_rowid='id', tokenize='trigram');
      CREATE TABLE sync_log (id INTEGER PRIMARY KEY, source_id INTEGER, file_path TEXT, status TEXT, message TEXT, synced_at TEXT);
      CREATE TABLE session_search (session_id INTEGER PRIMARY KEY, title TEXT DEFAULT '', user_text TEXT DEFAULT '', assistant_text TEXT DEFAULT '', updated_at TEXT);
      CREATE VIRTUAL TABLE session_search_fts USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id');
      CREATE VIRTUAL TABLE session_search_fts_trigram USING fts5(title, user_text, assistant_text, content='session_search', content_rowid='session_id', tokenize='trigram');
      CREATE TABLE stars (
        item_type TEXT NOT NULL CHECK (item_type IN ('session','capture')),
        item_uuid TEXT NOT NULL,
        starred_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (item_type, item_uuid)
      );
    `)
    seed.pragma('user_version = 4')
    seed.close()

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    runMigrations(db)
    db.close()

    const backups = readdirSync(join(dir, 'backups'))
    expect(backups.some((f) => /^spool-pre-v5-.*\.db$/.test(f))).toBe(true)
  })

  it('skips backup on a fresh-install migration (no prior session data)', () => {
    const dir = makeTempDir('spool-mig-backup-fresh-')
    const dbPath = join(dir, 'spool.db')

    const db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    runMigrations(db)
    db.close()

    let backupsExisted = true
    try {
      readdirSync(join(dir, 'backups'))
    } catch {
      backupsExisted = false
    }
    expect(backupsExisted).toBe(false)
  })
})

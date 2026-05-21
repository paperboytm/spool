import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { cleanBackups, vacuumDb } from './maintenance.js'

const tempDirs: string[] = []

afterEach(() => {
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

function touchBackup(dir: string, name: string, mtimeS: number): string {
  const full = join(dir, name)
  writeFileSync(full, `payload-for-${name}`)
  utimesSync(full, mtimeS, mtimeS)
  return full
}

describe('cleanBackups', () => {
  let dir: string
  let backupDir: string
  let db: Database.Database

  beforeEach(() => {
    dir = makeTempDir('spool-maint-')
    backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    db = new Database(join(dir, 'spool.db'))
  })

  it('keeps the N most-recent matching backups and removes the rest', () => {
    // mtime ascending: a < b < c < d < e
    touchBackup(backupDir, 'spool-pre-v5-2026-01-01T00-00-00.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v5-2026-01-02T00-00-00.db', 1_700_000_100)
    touchBackup(backupDir, 'spool-pre-v7-2026-01-03T00-00-00.db', 1_700_000_200)
    touchBackup(backupDir, 'spool-pre-v9-2026-01-04T00-00-00.db', 1_700_000_300)
    const newest = touchBackup(backupDir, 'spool-pre-v9-2026-01-05T00-00-00.db', 1_700_000_400)

    const result = cleanBackups(db, { keep: 2 })

    expect(result.removed).toBe(3)
    expect(result.kept).toBe(2)
    expect(result.bytesFreed).toBeGreaterThan(0)
    expect(result.backupDir).toBe(backupDir)

    const remaining = readdirSync(backupDir)
    expect(remaining).toHaveLength(2)
    expect(remaining).toContain('spool-pre-v9-2026-01-05T00-00-00.db')
    expect(remaining).toContain('spool-pre-v9-2026-01-04T00-00-00.db')
    expect(existsSync(newest)).toBe(true)
  })

  it('keeps everything when keep >= file count', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v5-b.db', 1_700_000_100)

    const result = cleanBackups(db, { keep: 5 })

    expect(result.removed).toBe(0)
    expect(result.kept).toBe(2)
    expect(result.bytesFreed).toBe(0)
    expect(readdirSync(backupDir)).toHaveLength(2)
  })

  it('keep=0 removes every matching backup', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v9-b.db', 1_700_000_100)

    const result = cleanBackups(db, { keep: 0 })

    expect(result.removed).toBe(2)
    expect(result.kept).toBe(0)
    expect(readdirSync(backupDir)).toHaveLength(0)
  })

  it('ignores files that do not match the backup naming pattern', () => {
    writeFileSync(join(backupDir, 'NOTES.md'), 'unrelated')
    writeFileSync(join(backupDir, 'random.sqlite'), 'unrelated')
    touchBackup(backupDir, 'spool-pre-v5-old.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v5-newer.db', 1_700_000_100)

    const result = cleanBackups(db, { keep: 1 })

    expect(result.removed).toBe(1)
    expect(result.kept).toBe(1)
    // Non-matching files untouched.
    const remaining = readdirSync(backupDir).sort()
    expect(remaining).toContain('NOTES.md')
    expect(remaining).toContain('random.sqlite')
    expect(remaining).toContain('spool-pre-v5-newer.db')
  })

  it('returns a zero-result when the backups directory does not exist', () => {
    rmSync(backupDir, { recursive: true, force: true })

    const result = cleanBackups(db, { keep: 3 })

    expect(result.removed).toBe(0)
    expect(result.kept).toBe(0)
    expect(result.bytesFreed).toBe(0)
    expect(result.backupDir).toBe(backupDir)
  })

  it('rejects a negative keep', () => {
    expect(() => cleanBackups(db, { keep: -1 })).toThrow(/non-negative/)
  })

  it('returns null backupDir for an in-memory DB', () => {
    const mem = new Database(':memory:')
    const result = cleanBackups(mem, { keep: 3 })
    mem.close()

    expect(result.backupDir).toBeNull()
    expect(result.removed).toBe(0)
  })
})

describe('vacuumDb', () => {
  it('runs VACUUM against a temp DB without throwing and reports sizes', () => {
    const dir = makeTempDir('spool-vacuum-')
    const dbPath = join(dir, 'spool.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE filler (id INTEGER PRIMARY KEY, blob TEXT NOT NULL);
    `)
    // Fill + delete to force fragmentation; VACUUM should reclaim it.
    const insert = db.prepare('INSERT INTO filler (blob) VALUES (?)')
    db.transaction(() => {
      for (let i = 0; i < 500; i++) insert.run('x'.repeat(2048))
    })()
    db.exec('DELETE FROM filler')

    const sizeBefore = statSync(dbPath).size
    const result = vacuumDb(db)

    expect(result.sizeBefore).toBe(sizeBefore)
    expect(result.sizeAfter).toBeLessThanOrEqual(sizeBefore)
    expect(result.bytesFreed).toBe(result.sizeBefore - result.sizeAfter)
    // The on-disk size should have actually shrunk after the DELETE.
    expect(result.bytesFreed).toBeGreaterThan(0)

    db.close()
  })

  it('runs against a freshly-created empty DB', () => {
    const dir = makeTempDir('spool-vacuum-')
    const db = new Database(join(dir, 'spool.db'))
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')

    const result = vacuumDb(db)
    expect(result.sizeBefore).toBeGreaterThan(0)
    expect(result.sizeAfter).toBeGreaterThan(0)

    db.close()
  })
})

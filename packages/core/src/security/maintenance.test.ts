import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { listBackups, deleteBackups } from './maintenance.js'

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

function touchBackup(dir: string, name: string, mtimeS: number, payload = `payload-for-${name}`): string {
  const full = join(dir, name)
  writeFileSync(full, payload)
  utimesSync(full, mtimeS, mtimeS)
  return full
}

describe('listBackups', () => {
  let dir: string
  let backupDir: string
  let db: Database.Database

  beforeEach(() => {
    dir = makeTempDir('spool-maint-')
    backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    db = new Database(join(dir, 'spool.db'))
  })

  it('lists every spool-pre-*.db file and tags auto vs manual', () => {
    touchBackup(backupDir, 'spool-pre-v5-2026-01-01T00-00-00.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v9-2026-01-02T00-00-00.db', 1_700_000_100)
    touchBackup(backupDir, 'spool-pre-pr5-revert-2026-01-03T00-00-00.db', 1_700_000_200)
    touchBackup(backupDir, 'spool-pre-codex-cleanup-2026-01-04T00-00-00.db', 1_700_000_300)

    const list = listBackups(db)

    expect(list).toHaveLength(4)
    const byName = Object.fromEntries(list.map(b => [b.name, b]))
    expect(byName['spool-pre-v5-2026-01-01T00-00-00.db']!.kind).toBe('auto')
    expect(byName['spool-pre-v9-2026-01-02T00-00-00.db']!.kind).toBe('auto')
    expect(byName['spool-pre-pr5-revert-2026-01-03T00-00-00.db']!.kind).toBe('manual')
    expect(byName['spool-pre-codex-cleanup-2026-01-04T00-00-00.db']!.kind).toBe('manual')
    for (const b of list) {
      expect(b.sizeBytes).toBeGreaterThan(0)
      expect(b.mtimeMs).toBeGreaterThan(0)
    }
  })

  it('returns rows ordered newest-first by mtime', () => {
    touchBackup(backupDir, 'spool-pre-v5-old.db', 1_700_000_000)
    touchBackup(backupDir, 'spool-pre-v5-mid.db', 1_700_000_100)
    touchBackup(backupDir, 'spool-pre-v5-new.db', 1_700_000_200)

    const names = listBackups(db).map(b => b.name)
    expect(names).toEqual([
      'spool-pre-v5-new.db',
      'spool-pre-v5-mid.db',
      'spool-pre-v5-old.db',
    ])
  })

  it('ignores files not matching spool-pre-*.db', () => {
    writeFileSync(join(backupDir, 'NOTES.md'), 'unrelated')
    writeFileSync(join(backupDir, 'random.sqlite'), 'unrelated')
    writeFileSync(join(backupDir, 'spool-other.db'), 'unrelated')
    touchBackup(backupDir, 'spool-pre-v5-keep.db', 1_700_000_000)

    const list = listBackups(db)
    expect(list.map(b => b.name)).toEqual(['spool-pre-v5-keep.db'])
  })

  it('returns [] when the backups directory does not exist', () => {
    rmSync(backupDir, { recursive: true, force: true })
    expect(listBackups(db)).toEqual([])
  })

  it('returns [] for an in-memory DB', () => {
    const mem = new Database(':memory:')
    expect(listBackups(mem)).toEqual([])
    mem.close()
  })
})

describe('deleteBackups', () => {
  let dir: string
  let backupDir: string
  let db: Database.Database

  beforeEach(() => {
    dir = makeTempDir('spool-maint-')
    backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    db = new Database(join(dir, 'spool.db'))
  })

  it('removes only the named files and reports bytes freed', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000, 'A'.repeat(100))
    touchBackup(backupDir, 'spool-pre-v9-b.db', 1_700_000_100, 'B'.repeat(200))
    touchBackup(backupDir, 'spool-pre-manual-c.db', 1_700_000_200, 'C'.repeat(300))

    const res = deleteBackups(db, ['spool-pre-v5-a.db', 'spool-pre-manual-c.db'])

    expect(res.deleted).toBe(2)
    expect(res.bytesFreed).toBe(400)
    expect(readdirSync(backupDir).sort()).toEqual(['spool-pre-v9-b.db'])
  })

  it('skips path traversal attempts', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    const sentinel = join(dir, 'OUTSIDE.txt')
    writeFileSync(sentinel, 'must-survive')

    const res = deleteBackups(db, ['../OUTSIDE.txt', 'spool-pre-v5-a.db'])

    expect(res.deleted).toBe(1)
    expect(existsSync(sentinel)).toBe(true)
    expect(readdirSync(backupDir)).toEqual([])
  })

  it('skips names that do not match the backup pattern', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    writeFileSync(join(backupDir, 'NOTES.md'), 'keep')

    const res = deleteBackups(db, ['NOTES.md', 'spool-pre-v5-a.db'])

    expect(res.deleted).toBe(1)
    expect(readdirSync(backupDir)).toEqual(['NOTES.md'])
  })

  it('is a no-op when names is empty', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    const res = deleteBackups(db, [])
    expect(res).toEqual({ deleted: 0, bytesFreed: 0 })
    expect(readdirSync(backupDir)).toHaveLength(1)
  })

  it('tolerates a missing file (already deleted)', () => {
    touchBackup(backupDir, 'spool-pre-v5-a.db', 1_700_000_000)
    const res = deleteBackups(db, ['spool-pre-v5-a.db', 'spool-pre-v5-never-existed.db'])
    expect(res.deleted).toBe(1)
  })
})


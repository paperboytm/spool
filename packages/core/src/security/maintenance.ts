import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'

// Matches snapshots written by `backupBeforeDestructive` (db.ts);
// foreign files in the backups dir are left untouched.
const BACKUP_FILENAME_RE = /^spool-pre-v\d+-.*\.db$/

export interface CleanBackupsResult {
  removed: number
  kept: number
  bytesFreed: number
  backupDir: string | null
}

export interface CleanBackupsOpts {
  keep: number
}

export function backupDirFor(db: Database.Database): string | null {
  if (db.memory) return null
  const dbPath = db.name
  if (!dbPath) return null
  return join(dirname(dbPath), 'backups')
}

export function cleanBackups(
  db: Database.Database,
  opts: CleanBackupsOpts,
): CleanBackupsResult {
  if (!Number.isInteger(opts.keep) || opts.keep < 0) {
    throw new Error(`cleanBackups: 'keep' must be a non-negative integer, got ${opts.keep}`)
  }

  const backupDir = backupDirFor(db)
  if (!backupDir || !existsSync(backupDir)) {
    return { removed: 0, kept: 0, bytesFreed: 0, backupDir }
  }

  const entries = readdirSync(backupDir)
    .filter((name) => BACKUP_FILENAME_RE.test(name))
    .map((name) => {
      const full = join(backupDir, name)
      try {
        const st = statSync(full)
        return { full, mtimeMs: st.mtimeMs, size: st.size }
      } catch {
        // stat may race with a concurrent delete; skip on error.
        return null
      }
    })
    .filter((e): e is { full: string; mtimeMs: number; size: number } => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)

  const toRemove = entries.slice(opts.keep)
  const kept = entries.length - toRemove.length

  let bytesFreed = 0
  let removed = 0
  for (const e of toRemove) {
    try {
      rmSync(e.full, { force: true })
      bytesFreed += e.size
      removed += 1
    } catch {
      // best-effort; leave in place if rm fails.
    }
  }

  return { removed, kept, bytesFreed, backupDir }
}

export interface VacuumDbResult {
  bytesFreed: number
  sizeBefore: number
  sizeAfter: number
}

// VACUUM cannot run inside a transaction and rebuilds the entire DB
// file; callers are UI-triggered IPC handlers, never inside a txn.
export function vacuumDb(db: Database.Database): VacuumDbResult {
  const dbPath = db.name
  const sizeBefore = sizeOnDisk(dbPath)
  db.exec('VACUUM')
  const sizeAfter = sizeOnDisk(dbPath)
  return {
    bytesFreed: sizeBefore - sizeAfter,
    sizeBefore,
    sizeAfter,
  }
}

function sizeOnDisk(dbPath: string | undefined): number {
  if (!dbPath) return 0
  try {
    return statSync(dbPath).size
  } catch {
    return 0
  }
}

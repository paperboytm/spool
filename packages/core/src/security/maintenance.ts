// Settings → Security → Maintenance helpers.
//
// Two user-triggered, destructive-ish operations exposed in the
// Security pane. Both are intentionally manual — never invoked on
// app startup.
//
//  - cleanBackups({ keep }): prune `<dbDir>/backups/spool-pre-v*.db`
//    snapshots written by `backupBeforeDestructive()` (see db.ts).
//    Keeps the N most-recent (by mtime) and unlinks the rest. The
//    backups directory itself is left in place even when empty.
//
//  - vacuumDb(db): runs SQLite `VACUUM` against the open handle to
//    reclaim fragmentation. VACUUM cannot run inside a transaction
//    and rebuilds the entire DB file, so on a busy machine it can
//    take a few seconds — the caller is the UI button, which surfaces
//    that latency.
//
// These deliberately do NOT take an `Effect.Effect` shape: the IPC
// layer wraps them with the same Promise-only contract the rest of
// the renderer-facing security surface uses.

import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import type Database from 'better-sqlite3'

/** Filename pattern produced by `backupBeforeDestructive`. Anything
 *  else in the backups dir (foreign tools, manual copies) is left
 *  untouched. */
const BACKUP_FILENAME_RE = /^spool-pre-v\d+-.*\.db$/

export interface CleanBackupsResult {
  /** Files actually unlinked. */
  removed: number
  /** Files preserved (the N most-recent matching backups). */
  kept: number
  /** Sum of bytes freed by removal. */
  bytesFreed: number
  /** Absolute path of the backups directory inspected; `null` when
   *  no backups directory exists (fresh install, in-memory DB). */
  backupDir: string | null
}

export interface CleanBackupsOpts {
  /** Number of most-recent backup files to keep. Must be >= 0. */
  keep: number
}

/** Resolve the conventional backups directory for an open DB handle. */
export function backupDirFor(db: Database.Database): string | null {
  if (db.memory) return null
  const dbPath = db.name
  if (!dbPath) return null
  return join(dirname(dbPath), 'backups')
}

/** Delete older `spool-pre-vN-*.db` snapshots, keeping the N most
 *  recent. Returns counts + bytes freed so the UI can show a useful
 *  result string. */
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
      let mtimeMs = 0
      let size = 0
      try {
        const st = statSync(full)
        mtimeMs = st.mtimeMs
        size = st.size
      } catch {
        // stat may race with a concurrent delete; skip on error.
        return null
      }
      return { full, mtimeMs, size }
    })
    .filter((e): e is { full: string; mtimeMs: number; size: number } => e !== null)
    // Newest first — slice(keep) yields the rotation tail.
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
      // best-effort; leave the file in place if rm fails.
    }
  }

  return { removed, kept, bytesFreed, backupDir }
}

export interface VacuumDbResult {
  /** Bytes the file shrank by; can be 0 (already compact) or, in
   *  rare cases, negative (page-size rebuild grew the file). */
  bytesFreed: number
  /** File size before VACUUM, in bytes. */
  sizeBefore: number
  /** File size after VACUUM, in bytes. */
  sizeAfter: number
}

/** Run SQLite VACUUM against the open handle. VACUUM cannot run
 *  inside a transaction and will throw if any other connection is
 *  holding write locks — better-sqlite3 surfaces that as a
 *  `SqliteError`. We let it propagate; the IPC layer turns it into
 *  a rejected Promise. */
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

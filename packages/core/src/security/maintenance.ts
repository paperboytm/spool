import {
  existsSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type Database from 'better-sqlite3'

// Listed in the UI: any snapshot Spool itself produced under
// ~/.spool/backups/. The narrower regex below distinguishes automated
// schema-migration snapshots (kind: 'auto') from human-named rollback
// points (kind: 'manual') so the UI can surface that difference.
const SPOOL_BACKUP_RE = /^spool-pre-.+\.db$/
const AUTO_BACKUP_RE = /^spool-pre-v\d+-/

export interface BackupFileInfo {
  name: string
  sizeBytes: number
  mtimeMs: number
  kind: 'auto' | 'manual'
}

export interface DeleteBackupsResult {
  deleted: number
  bytesFreed: number
}

export function backupDirFor(db: Database.Database): string | null {
  if (db.memory) return null
  const dbPath = db.name
  if (!dbPath) return null
  return join(dirname(dbPath), 'backups')
}

export function listBackups(db: Database.Database): BackupFileInfo[] {
  const backupDir = backupDirFor(db)
  if (!backupDir || !existsSync(backupDir)) return []

  return readdirSync(backupDir)
    .filter((name) => SPOOL_BACKUP_RE.test(name))
    .map((name): BackupFileInfo | null => {
      try {
        const st = statSync(join(backupDir, name))
        return {
          name,
          sizeBytes: st.size,
          mtimeMs: st.mtimeMs,
          kind: AUTO_BACKUP_RE.test(name) ? 'auto' : 'manual',
        }
      } catch {
        // stat may race with a concurrent delete; skip on error.
        return null
      }
    })
    .filter((e): e is BackupFileInfo => e !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

export function deleteBackups(
  db: Database.Database,
  names: readonly string[],
): DeleteBackupsResult {
  const backupDir = backupDirFor(db)
  if (!backupDir || !existsSync(backupDir) || names.length === 0) {
    return { deleted: 0, bytesFreed: 0 }
  }

  let deleted = 0
  let bytesFreed = 0
  for (const name of names) {
    // Reject path traversal: a malicious or buggy caller must not be
    // able to delete files outside the backups dir.
    if (basename(name) !== name) continue
    if (!SPOOL_BACKUP_RE.test(name)) continue
    const full = join(backupDir, name)
    try {
      const st = statSync(full)
      rmSync(full, { force: true })
      deleted += 1
      bytesFreed += st.size
    } catch {
      // best-effort; missing file = already gone, treat as no-op.
    }
  }
  return { deleted, bytesFreed }
}


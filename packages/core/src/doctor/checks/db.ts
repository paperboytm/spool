import { existsSync, statSync } from 'node:fs'

import type Database from 'better-sqlite3'

import { DB_PATH } from '../../db/db.js'
import { openDatabase } from '../../db/native-binding.js'
import { probeSqlite } from '../preflight.js'
import type { Check, CheckResult, FixDescriptor } from '../types.js'

const WAL_PATH = `${DB_PATH}-wal`
const WAL_WARN_RATIO = 0.5
const WAL_WARN_MIN_BYTES = 16 * 1024 * 1024
const VACUUM_HINT_RATIO = 0.25

export const dbChecks: Check[] = [
  {
    id: 'db.exists',
    category: 'db',
    title: 'Database file',
    run: (): CheckResult => {
      if (!existsSync(DB_PATH)) {
        return {
          id: 'db.exists',
          category: 'db',
          title: 'Database file',
          severity: 'warn',
          message: `Not found at ${DB_PATH} — run \`spool sync\` to create it`,
          details: { path: DB_PATH },
        }
      }
      const size = statSync(DB_PATH).size
      return {
        id: 'db.exists',
        category: 'db',
        title: 'Database file',
        severity: 'ok',
        message: `${humanBytes(size)} at ${DB_PATH}`,
        details: { path: DB_PATH, sizeBytes: size },
      }
    },
  },
  {
    id: 'db.integrity',
    category: 'db',
    title: 'Database integrity',
    run: (): CheckResult =>
      withReadonlyDb('db.integrity', 'Database integrity', (db) => {
        const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
        const messages = rows.map((r) => r.integrity_check)
        if (messages.length === 1 && messages[0] === 'ok') {
          return { severity: 'ok', message: 'integrity_check passed' }
        }
        return {
          severity: 'error',
          message: `integrity_check reported ${messages.length} problem(s)`,
          details: { problems: messages.slice(0, 20) },
        }
      }),
  },
  {
    id: 'db.foreign-keys',
    category: 'db',
    title: 'Foreign key consistency',
    run: (): CheckResult =>
      withReadonlyDb('db.foreign-keys', 'Foreign key consistency', (db) => {
        const rows = db.pragma('foreign_key_check') as Array<{
          table: string
          rowid: number
          parent: string
          fkid: number
        }>
        if (rows.length === 0) {
          return { severity: 'ok', message: 'foreign_key_check passed' }
        }
        const byTable = new Map<string, number>()
        for (const r of rows) byTable.set(r.table, (byTable.get(r.table) ?? 0) + 1)
        const summary = Array.from(byTable.entries())
          .map(([t, n]) => `${t}: ${n}`)
          .join(', ')

        const fix: FixDescriptor = {
          description: `Delete ${rows.length} orphaned row(s) (${summary})`,
          destructive: false,
          apply: () => applyForeignKeyCleanup(rows),
        }
        return {
          severity: 'error',
          message: `${rows.length} orphan row(s) — ${summary}`,
          details: { violations: rows.slice(0, 50) },
          fix,
        }
      }),
  },
  {
    id: 'db.wal-size',
    category: 'db',
    title: 'WAL size',
    run: (): CheckResult => {
      if (!existsSync(DB_PATH)) {
        return skipped('db.wal-size', 'WAL size')
      }
      const dbSize = statSync(DB_PATH).size
      let walSize = 0
      try {
        walSize = statSync(WAL_PATH).size
      } catch {
        /* WAL file optional */
      }
      const ratio = dbSize > 0 ? walSize / dbSize : 0
      const oversized = walSize >= WAL_WARN_MIN_BYTES && ratio >= WAL_WARN_RATIO
      if (!oversized) {
        return {
          id: 'db.wal-size',
          category: 'db',
          title: 'WAL size',
          severity: 'ok',
          message:
            walSize === 0
              ? 'WAL empty'
              : `${humanBytes(walSize)} (${(ratio * 100).toFixed(0)}% of db)`,
          details: { walBytes: walSize, dbBytes: dbSize },
        }
      }
      return {
        id: 'db.wal-size',
        category: 'db',
        title: 'WAL size',
        severity: 'warn',
        message: `WAL is ${humanBytes(walSize)} (${(ratio * 100).toFixed(0)}% of db)`,
        details: { walBytes: walSize, dbBytes: dbSize },
        fix: {
          description: 'Checkpoint the WAL into the main database',
          destructive: false,
          apply: () => applyWalCheckpoint(),
        },
      }
    },
  },
  {
    id: 'db.vacuum-hint',
    category: 'db',
    title: 'Free-page ratio',
    run: (): CheckResult =>
      withReadonlyDb('db.vacuum-hint', 'Free-page ratio', (db) => {
        const free =
          (db.pragma('freelist_count') as Array<{ freelist_count: number }>)[0]?.freelist_count ?? 0
        const total = (db.pragma('page_count') as Array<{ page_count: number }>)[0]?.page_count ?? 0
        const ratio = total > 0 ? free / total : 0
        const hint = total > 0 && ratio >= VACUUM_HINT_RATIO
        if (!hint) {
          return {
            severity: 'ok',
            message: total === 0 ? 'empty db' : `${(ratio * 100).toFixed(1)}% free pages`,
            details: { freePages: free, totalPages: total },
          }
        }
        return {
          severity: 'warn',
          message: `${(ratio * 100).toFixed(1)}% of pages are free — vacuum will reclaim space`,
          details: { freePages: free, totalPages: total },
          fix: {
            description: 'Run VACUUM to compact the database',
            destructive: false,
            apply: () => applyVacuum(),
          },
        }
      }),
  },
]

/* ── helpers ──────────────────────────────────────────────────────────── */

type WithDbResult = {
  severity: CheckResult['severity']
  message: string
  details?: Record<string, unknown>
  fix?: FixDescriptor
}

function withReadonlyDb(
  id: string,
  title: string,
  fn: (db: Database.Database) => WithDbResult,
): CheckResult {
  const sqlite = probeSqlite()
  if (!sqlite.ok) {
    return { id, category: 'db', title, severity: 'warn', message: 'skipped — see `native.sqlite`' }
  }
  if (!existsSync(DB_PATH)) return skipped(id, title)
  const db = openDatabase(DB_PATH, { readonly: true, fileMustExist: true })
  try {
    const out = fn(db)
    return { id, category: 'db', title, ...out }
  } finally {
    db.close()
  }
}

function skipped(id: string, title: string): CheckResult {
  return {
    id,
    category: 'db',
    title,
    severity: 'ok',
    message: 'skipped — no database',
  }
}

function applyForeignKeyCleanup(
  violations: Array<{ table: string; rowid: number; parent: string; fkid: number }>,
): { ok: boolean; message: string } {
  const db = openDatabase(DB_PATH)
  try {
    db.pragma('foreign_keys = OFF')
    const grouped = new Map<string, number[]>()
    for (const v of violations) {
      const arr = grouped.get(v.table) ?? []
      arr.push(v.rowid)
      grouped.set(v.table, arr)
    }
    const tx = db.transaction(() => {
      for (const [table, rowids] of grouped) {
        const stmt = db.prepare(`DELETE FROM "${table.replace(/"/g, '""')}" WHERE rowid = ?`)
        for (const rid of rowids) stmt.run(rid)
      }
    })
    tx()
    return { ok: true, message: `Removed ${violations.length} orphan row(s)` }
  } finally {
    db.close()
  }
}

function applyWalCheckpoint(): { ok: boolean; message: string } {
  const db = openDatabase(DB_PATH)
  try {
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as Array<{
      busy: number
      log: number
      checkpointed: number
    }>
    const r = result[0]
    if (!r) return { ok: true, message: 'WAL checkpointed' }
    if (r.busy)
      return {
        ok: false,
        message: 'WAL checkpoint reported busy — close other Spool processes and retry',
      }
    return { ok: true, message: `Checkpointed ${r.checkpointed}/${r.log} frames` }
  } finally {
    db.close()
  }
}

function applyVacuum(): { ok: boolean; message: string } {
  const db = openDatabase(DB_PATH)
  try {
    const before = statSync(DB_PATH).size
    db.exec('VACUUM')
    const after = statSync(DB_PATH).size
    return { ok: true, message: `Reclaimed ${humanBytes(Math.max(before - after, 0))}` }
  } finally {
    db.close()
  }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

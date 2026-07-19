import { openDatabase } from '../db/native-binding.js'

type SqliteStatus = { ok: true } | { ok: false; error: Error }

let cached: SqliteStatus | null = null

/**
 * Confirms the bundled better-sqlite3 binary can actually load and open a
 * database. The most common failure is a Node ABI mismatch (NODE_MODULE_VERSION)
 * after upgrading Node without rebuilding native modules — that error message
 * is verbose, so we capture it once here and let downstream checks short-circuit
 * with a short pointer to `native.sqlite`.
 */
export function probeSqlite(): SqliteStatus {
  if (cached) return cached
  try {
    const db = openDatabase(':memory:')
    db.close()
    cached = { ok: true }
  } catch (err) {
    cached = { ok: false, error: err instanceof Error ? err : new Error(String(err)) }
  }
  return cached
}

/** Test hook — reset the cache between runs. */
export function _resetProbeForTest(): void {
  cached = null
}

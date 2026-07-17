import { parentPort } from 'node:worker_threads'
import { getDB, Syncer } from '@spool-lab/core'
import type { SyncProgressEvent } from '@spool-lab/core'
import type { SyncResult } from '@spool-lab/core'

export type SyncWorkerMessage =
  | { type: 'progress'; data: SyncProgressEvent }
  | { type: 'done'; result: SyncResult }
  | { type: 'error'; error: string }

function reportAndExit(err: unknown): void {
  try {
    parentPort?.postMessage({
      type: 'error',
      error: err instanceof Error ? (err.stack ?? err.message) : String(err),
    } satisfies SyncWorkerMessage)
  } catch { /* parent gone — nothing we can do */ }
  process.exit(1)
}

// Node 22 defaults to --unhandled-rejections=strict: any unhandled Promise
// rejection in a worker thread aborts the entire host process with SIGTRAP,
// not just the worker. Capturing them here converts that abort into a clean
// 'error' message that the parent already knows how to handle.
process.on('unhandledRejection', reportAndExit)
process.on('uncaughtException', reportAndExit)

try {
  // Main process already migrated the file before this worker
  // spawns; skipping here keeps two threads from racing through
  // the same CREATE-TRIGGER migration step.
  const db = getDB({ runMigrations: false })
  const syncer = new Syncer(db, (event) => {
    parentPort?.postMessage({ type: 'progress', data: event } satisfies SyncWorkerMessage)
  })
  const result = syncer.syncAll()
  parentPort?.postMessage({ type: 'done', result } satisfies SyncWorkerMessage)
} catch (err) {
  reportAndExit(err)
}

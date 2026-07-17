// Security mutation worker — runs purge / dismiss / undismiss SQL
// in a dedicated worker_thread so the main process event loop stays
// unblocked even during the multi-second tail of bulk operations on
// a large archive (a fresh `purgeFindings(8k)` was ~1.4s post-#346;
// fast enough that we shipped the bug fix but slow enough that
// hover responsiveness and other IPC channels still froze for the
// duration).
//
// Architecture (mirror of scan-worker-thread.ts):
//
//   • Opens its own better-sqlite3 handle via getDB(). WAL mode (db.ts)
//     lets the main-process read handle plus the scan worker's write
//     handle coexist with this thread's write handle — SQLite
//     serialises writes via the WAL but never blocks reads.
//   • Receives mutation commands on parentPort, runs them via the
//     existing core helpers (`purgeFinding`, `dismissFindings`, …),
//     and posts back either a typed result or a typed error.
//   • Publishes `FindingsChange` events as they happen so main can
//     forward them to the renderer without changing the existing
//     EVT_FINDINGS_CHANGED contract.
//   • A 'shutdown' message closes the Effect Scope cleanly and
//     exits 0. Unhandled rejections / exceptions post a 'fatal'
//     message and exit(1) — the parent's `worker.on('exit')` handler
//     surfaces that as "mutation worker died, fall back to main
//     thread" in the IPC layer.

import { parentPort, threadId } from 'node:worker_threads'
import { Effect } from 'effect'
import {
  getDB,
  purgeFinding as purgeFindingEff,
  purgeFindings as purgeFindingsEff,
  purgeEverywhere as purgeEverywhereEff,
  dismissFinding,
  dismissFindings,
  undismissFinding,
  type FindingsChange,
  type PurgeResult,
} from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'
import {
  exitToWireResult,
  flattenPurgeError,
  type PurgeErrorWire,
  type WireError,
} from './security/mutation-error-wire.js'

export type { PurgeErrorWire }

if (!parentPort) {
  throw new Error('mutation-worker-thread.ts is only meant to run as a worker_thread child')
}
const port = parentPort

export type MutationCommand =
  | { cmd: 'purgeFinding'; findingId: number }
  | { cmd: 'purgeFindings'; findingIds: number[] }
  | { cmd: 'purgeEverywhere'; kind: SensitiveKind; valueHash: string }
  | { cmd: 'dismissFinding'; findingId: number; scope: 'session' | 'global' }
  | { cmd: 'dismissFindings'; findingIds: number[]; scope: 'session' | 'global' }
  | { cmd: 'undismissFinding'; findingId: number }

export type MutationResult =
  | { ok: true; cmd: 'purgeFinding'; result: PurgeResult }
  | { ok: true; cmd: 'purgeFindings'; results: PurgeResult[] }
  | { ok: true; cmd: 'purgeEverywhere'; results: PurgeResult[]; sessionIds: number[] }
  | { ok: true; cmd: 'dismissFinding'; sessionId: number | null }
  | { ok: true; cmd: 'dismissFindings'; sessionIds: number[] }
  | { ok: true; cmd: 'undismissFinding'; sessionId: number | null }
  | { ok: false; error: WireError }

export type ToWorker =
  | { type: 'cmd'; reqId: number; payload: MutationCommand }
  | { type: 'shutdown' }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'cmd-result'; reqId: number; result: MutationResult }
  | { type: 'event-change'; change: FindingsChange }
  | { type: 'fatal'; error: string }

function reportFatal(err: unknown): void {
  const error = err instanceof Error ? (err.stack ?? err.message) : String(err)
  try {
    port.postMessage({ type: 'fatal', error } satisfies FromWorker)
  } catch { /* parent gone */ }
  process.exit(1)
}

// Node 22's --unhandled-rejections=strict default takes down the host
// process on any unhandled rejection inside a worker. Capturing both
// channels here converts those into structured 'fatal' messages.
process.on('unhandledRejection', reportFatal)
process.on('uncaughtException', reportFatal)

console.log('[security] mutation worker thread booted; threadId =', threadId)

// Main process already migrated the file before spawning this thread;
// skipping here avoids the FTS-trigger DROP/CREATE race between the
// three worker threads (sync, scan, mutation) that all open the same DB.
const db = getDB({ runMigrations: false })

function postSafe(msg: FromWorker): void {
  try { port.postMessage(msg) } catch { /* parent gone */ }
}

/** Forward a `FindingsChange` to main as it happens. The core purge
 *  helpers accept a `publish` callback that fires per touched session;
 *  we wrap it here so each emission becomes a postMessage. */
const publish = (change: FindingsChange) =>
  Effect.sync(() => postSafe({ type: 'event-change', change }))

async function handle(cmd: MutationCommand): Promise<MutationResult> {
  switch (cmd.cmd) {
    case 'purgeFinding': {
      const exit = await Effect.runPromiseExit(purgeFindingEff(cmd.findingId, { db, publish }))
      const wire = exitToWireResult(exit, (result) => result)
      return wire.ok
        ? { ok: true, cmd: 'purgeFinding', result: wire.success }
        : { ok: false, error: wire.error }
    }
    case 'purgeFindings': {
      const exit = await Effect.runPromiseExit(purgeFindingsEff(cmd.findingIds, { db, publish }))
      const wire = exitToWireResult(exit, (results) => results)
      return wire.ok
        ? { ok: true, cmd: 'purgeFindings', results: wire.success }
        : { ok: false, error: wire.error }
    }
    case 'purgeEverywhere': {
      const exit = await Effect.runPromiseExit(purgeEverywhereEff(cmd.kind, cmd.valueHash, { db, publish }))
      const wire = exitToWireResult(exit, (value) => value)
      return wire.ok
        ? { ok: true, cmd: 'purgeEverywhere', results: wire.success.results, sessionIds: wire.success.sessionIds }
        : { ok: false, error: wire.error }
    }
    case 'dismissFinding': {
      const sessionId = dismissFinding(db, cmd.findingId, cmd.scope)
      if (sessionId != null) {
        postSafe({
          type: 'event-change',
          change: { type: 'state-changed', sessionId, findingId: cmd.findingId, state: 'dismissed' },
        })
      }
      return { ok: true, cmd: 'dismissFinding', sessionId }
    }
    case 'dismissFindings': {
      const sessionIds = dismissFindings(db, cmd.findingIds, cmd.scope)
      for (const sessionId of sessionIds) {
        postSafe({
          type: 'event-change',
          change: { type: 'state-changed', sessionId, state: 'dismissed' },
        })
      }
      return { ok: true, cmd: 'dismissFindings', sessionIds }
    }
    case 'undismissFinding': {
      const sessionId = undismissFinding(db, cmd.findingId)
      if (sessionId != null) {
        postSafe({
          type: 'event-change',
          change: { type: 'state-changed', sessionId, findingId: cmd.findingId, state: 'active' },
        })
      }
      return { ok: true, cmd: 'undismissFinding', sessionId }
    }
  }
}

port.on('message', (msg: ToWorker) => {
  if (msg.type === 'shutdown') {
    try { db.close() } catch { /* best effort */ }
    process.exit(0)
  }
  if (msg.type !== 'cmd') return
  // Don't await — the per-command Promise is awaited inside `handle`,
  // and each response postMessage carries the originating reqId so the
  // proxy can route it to the right pending promise. Running them in
  // parallel matches the "multiple concurrent IPC actions" reality of
  // the renderer (e.g. user opens BlastRadius while a bulk purge is in
  // flight). SQLite WAL serialises the actual writes; the JS scheduling
  // here just hands the next request to better-sqlite3, which queues.
  void handle(msg.payload).then(
    (result) => postSafe({ type: 'cmd-result', reqId: msg.reqId, result }),
    (err) => postSafe({
      type: 'cmd-result',
      reqId: msg.reqId,
      result: { ok: false, error: flattenPurgeError(err) },
    }),
  )
})

postSafe({ type: 'ready' })

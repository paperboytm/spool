// Security Scan worker — runs in a dedicated worker_thread so its
// synchronous SQL + CPU work (regex matching across long sessions)
// never blocks the main process event loop. Window dragging and
// foreground IPC stay smooth while a full backfill is in flight.
//
// Architecture (mirror of sync-worker.ts):
//
//   • Opens its own better-sqlite3 handle via getDB(). With WAL
//     enabled (db.ts:32), the main-process query handle can read
//     concurrently while this thread writes scan output.
//   • Constructs makeScanWorker the same way main used to do
//     in-process, then exposes its commands + streams over
//     parentPort.postMessage.
//   • Reads preferences directly from ~/.spool/security.json on
//     every scan via the same loadSecurityPreferences helper. The
//     main process owns the file (SET_PREFS handler writes it);
//     this thread re-reads on every call so pref changes take
//     effect on the next session without restarting the worker.
//   • A 'shutdown' message closes the Effect Scope cleanly and
//     exits 0. Unhandled rejections / exceptions post a 'fatal'
//     message and exit(1) so the parent's `worker.on('exit')`
//     handler can decide what to do.
//
// Protocol — see `ToWorker` / `FromWorker` unions below.

import { parentPort, threadId } from 'node:worker_threads'
import { Effect, Exit, Fiber, Scope, Stream } from 'effect'
import {
  currentProfileString,
  getDB,
  makeScanWorker,
  type FindingsChange,
  type ScanStatus,
} from '@spool-lab/core'
import { regexProvider } from '@spool-lab/redact'
import { loadSecurityPreferences } from './securityPreferences.js'

if (!parentPort) {
  throw new Error('scan-worker-thread.ts is only meant to run as a worker_thread child')
}
const port = parentPort

export type ScanCommand =
  | { cmd: 'enqueue'; sessionId: number }
  | { cmd: 'rescanAll' }
  | { cmd: 'backfill' }
  | { cmd: 'getStatus' }

export type ToWorker =
  | { type: 'cmd'; reqId: number; payload: ScanCommand }
  | { type: 'shutdown' }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'cmd-result'; reqId: number; result: unknown }
  | { type: 'cmd-error'; reqId: number; error: string }
  | { type: 'event-change'; change: FindingsChange }
  | { type: 'event-status'; status: ScanStatus }
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

void (async () => {
  console.log('[security] scan worker thread booted; threadId =', threadId)
  // Main process already migrated the file before spawning this
  // thread; skipping here avoids a race with sync-worker (whose
  // getDB() also opens with migrations skipped now) over the
  // FTS-trigger DROP/CREATE steps.
  const db = getDB({ runMigrations: false })
  const scope = await Effect.runPromise(Scope.make())

  const worker = await Effect.runPromise(
    Effect.provideService(
      makeScanWorker({
        db,
        providers: [regexProvider],
        currentProfile: () => currentProfileString({
          kindAllowlist: loadSecurityPreferences().kindAllowlist,
        }),
        providerNames: ['regex'],
        getKindAllowlist: () => new Set(loadSecurityPreferences().kindAllowlist),
      }),
      Scope.Scope,
      scope,
    ),
  )

  // Forward both event streams over postMessage. Daemon fibers so
  // they outlive any single Effect.runPromise call site.
  //
  // `postMessage` throws synchronously when the parent's port has
  // closed (parent shutting down / child being terminated). We
  // swallow the throw here so the daemon fiber stays alive — when
  // shutdown is on the way, `port.on('message', shutdown)` will run
  // shortly and exit cleanly. Without this, a single failed post
  // tears down the fiber and every subsequent event is dropped.
  function safePost(msg: FromWorker): Effect.Effect<void> {
    return Effect.sync(() => {
      try { port.postMessage(msg) } catch { /* parent gone */ }
    })
  }

  const changesFiber = await Effect.runPromise(
    Effect.forkDaemon(
      Stream.runForEach(worker.changes, (change) =>
        safePost({ type: 'event-change', change }),
      ),
    ),
  )
  const statusFiber = await Effect.runPromise(
    Effect.forkDaemon(
      Stream.runForEach(worker.statusChanges, (status) =>
        safePost({ type: 'event-status', status }),
      ),
    ),
  )

  port.on('message', (msg: ToWorker) => {
    if (msg.type === 'shutdown') {
      void (async () => {
        try {
          // Interrupt forwarders first so no events leak in after the
          // parent has stopped listening, then close the scope which
          // tears down the worker's drain fiber + PubSubs.
          await Effect.runPromise(Fiber.interrupt(changesFiber))
          await Effect.runPromise(Fiber.interrupt(statusFiber))
          await Effect.runPromise(Scope.close(scope, Exit.void))
        } finally {
          process.exit(0)
        }
      })()
      return
    }
    if (msg.type !== 'cmd') return
    const { reqId, payload } = msg
    void (async () => {
      try {
        let result: unknown = null
        switch (payload.cmd) {
          case 'enqueue':
            await Effect.runPromise(worker.enqueue(payload.sessionId))
            break
          case 'rescanAll':
            result = await Effect.runPromise(worker.rescanAll())
            break
          case 'backfill':
            result = await Effect.runPromise(worker.backfill())
            break
          case 'getStatus':
            result = await Effect.runPromise(worker.getStatus)
            break
        }
        port.postMessage({ type: 'cmd-result', reqId, result } satisfies FromWorker)
      } catch (err) {
        const error = err instanceof Error ? (err.stack ?? err.message) : String(err)
        port.postMessage({ type: 'cmd-error', reqId, error } satisfies FromWorker)
      }
    })()
  })

  port.postMessage({ type: 'ready' } satisfies FromWorker)
})().catch(reportFatal)

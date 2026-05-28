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
import { join } from 'node:path'
import { Effect, Exit, Fiber, Scope, Stream } from 'effect'
import {
  currentProfileString,
  getDB,
  makeObservabilityRuntime,
  makeScanWorker,
  SPOOL_DIR,
  type FindingsChange,
  type ScanStatus,
} from '@spool-lab/core'
import { regexProvider, type RedactProvider, type SensitiveMatch } from '@spool-lab/redact'
import { loadSecurityPreferences } from './securityPreferences.js'
import { mapPfMatches, setUnknownLabelSink, type PfRawMatch } from './security/class-mapping.js'
import { detectWithRegex } from '@spool-lab/redact'
// Import directly from pf-version (no `electron` import). Going through
// model-paths.ts pulls `import { app } from 'electron'` into a shared
// Rollup chunk and crashes the worker at load with
// "Cannot find module 'electron'".
import { PF_PROFILE_VERSION } from './security/pf-version.js'

if (!parentPort) {
  throw new Error('scan-worker-thread.ts is only meant to run as a worker_thread child')
}
const port = parentPort

export type ScanCommand =
  | { cmd: 'enqueue'; sessionId: number }
  | { cmd: 'rescanAll' }
  | { cmd: 'backfill'; userInitiated?: boolean }
  | { cmd: 'getStatus' }

export interface PfRawMatchWire {
  class: string
  value: string
  start: number
  end: number
  score: number
}

export type ToWorker =
  | { type: 'cmd'; reqId: number; payload: ScanCommand }
  | { type: 'shutdown' }
  /** Main tells the worker the inference window is live + ready, so
   *  pfProvider.available() may start returning true. */
  | { type: 'pf-online' }
  | { type: 'pf-offline' }
  /** Response to an earlier pf-analyze-req. */
  | { type: 'pf-analyze-res'; reqId: number; ok: true; matches: PfRawMatchWire[] }
  | { type: 'pf-analyze-res'; reqId: number; ok: false; message: string }

export type FromWorker =
  | { type: 'ready' }
  | { type: 'cmd-result'; reqId: number; result: unknown }
  | { type: 'cmd-error'; reqId: number; error: string }
  | { type: 'event-change'; change: FindingsChange }
  | { type: 'event-status'; status: ScanStatus }
  | { type: 'fatal'; error: string }
  /** Worker asks main to run the inference window over `text`. Main
   *  routes to pfRuntime.analyze and posts a pf-analyze-res back. */
  | { type: 'pf-analyze-req'; reqId: number; text: string }

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

  // Worker has its own Effect runtime; without provisioning the layer
  // here, spans inside scanSession/backfill never reach an exporter.
  const isDevMode = Boolean(process.env['ELECTRON_RENDERER_URL'])
  const { run: runEff } = makeObservabilityRuntime(
    isDevMode
      ? { serviceName: 'spool-app-scan-worker', env: 'dev' }
      : { serviceName: 'spool-app-scan-worker', env: 'prod', logsDir: join(SPOOL_DIR, 'logs') },
  )

  // Make unknown PF labels observable in prod, not just the dev
  // console. A label that isn't in class-mapping's switch means a
  // server-side model bump emitted a class before the mapping table
  // was updated — those findings get dropped, and without this they
  // vanish with zero diagnostic. Emit a span (label as attribute, no
  // value) through the worker's own OTel runtime; the prod file
  // exporter persists it to ~/.spool/logs. Fire-and-forget so the scan
  // hot path never awaits the export.
  setUnknownLabelSink((label) => {
    void runEff(
      Effect.void.pipe(Effect.withSpan('pf.unknown_label', { attributes: { label } })),
    ).catch(() => {})
  })

  // Main process already migrated the file before spawning this
  // thread; skipping here avoids a race with sync-worker (whose
  // getDB() also opens with migrations skipped now) over the
  // FTS-trigger DROP/CREATE steps.
  const db = getDB({ runMigrations: false })
  const scope = await Effect.runPromise(Scope.make())

  // PF analyze bridge — worker → main → inference window. The flag is
  // flipped by 'pf-online'/'pf-offline' messages from main; available()
  // reads it synchronously so the scan loop doesn't have to await
  // anything before deciding whether to call this provider.
  let pfOnline = false
  let pfNextReqId = 1
  const pfPending = new Map<number, { resolve: (m: PfRawMatchWire[]) => void; reject: (e: Error) => void }>()

  const pfProvider: RedactProvider = {
    name: 'pf',
    displayName: 'Privacy Filter (ML)',
    available: () => pfOnline && loadSecurityPreferences().pfEnabled,
    analyze: async (text: string): Promise<SensitiveMatch[]> => {
      // Short-circuit empty / whitespace-only chunks. The model's
      // GatherBlockQuantized op fails with "Invalid dispatch group
      // size (0, 1, 1)" on zero-token input; cheaper for everyone to
      // skip the IPC round-trip entirely.
      if (text.trim().length === 0) return []
      const reqId = pfNextReqId++
      const raw: PfRawMatchWire[] = await new Promise((resolve, reject) => {
        pfPending.set(reqId, { resolve, reject })
        try {
          port.postMessage({ type: 'pf-analyze-req', reqId, text } satisfies FromWorker)
        } catch (err) {
          pfPending.delete(reqId)
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
      if (raw.length === 0) return []
      // Regex pass for class-mapping suppression context (url/secret
      // boost rules, DOB gating). Cheap and stateless — same input text
      // the scan engine already ran regex over upstream, but we don't
      // have access to those matches here.
      const regexMatches = detectWithRegex(text, 'regex')
      return mapPfMatches(raw as PfRawMatch[], { regexMatches, fullText: text })
    },
  }

  const worker = await runEff(
    Effect.provideService(
      makeScanWorker({
        db,
        providers: [regexProvider, pfProvider],
        currentProfile: () => currentProfileString({
          kindAllowlist: loadSecurityPreferences().kindAllowlist,
          pfEnabled: loadSecurityPreferences().pfEnabled && pfOnline,
          pfVersion: PF_PROFILE_VERSION,
        }),
        providerNames: ['regex', 'pf'],
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

  const changesFiber = await runEff(
    Effect.forkDaemon(
      Stream.runForEach(worker.changes, (change) =>
        safePost({ type: 'event-change', change }),
      ),
    ),
  )
  const statusFiber = await runEff(
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
          await runEff(Fiber.interrupt(changesFiber))
          await runEff(Fiber.interrupt(statusFiber))
          await runEff(Scope.close(scope, Exit.void))
        } finally {
          process.exit(0)
        }
      })()
      return
    }
    if (msg.type === 'pf-online') { pfOnline = true; return }
    if (msg.type === 'pf-offline') {
      pfOnline = false
      // Reject every pending analyze so the scan loop unblocks.
      for (const slot of pfPending.values()) slot.reject(new Error('pf offline'))
      pfPending.clear()
      return
    }
    if (msg.type === 'pf-analyze-res') {
      const slot = pfPending.get(msg.reqId)
      if (!slot) return
      pfPending.delete(msg.reqId)
      if (msg.ok) slot.resolve(msg.matches)
      else slot.reject(new Error(msg.message))
      return
    }
    if (msg.type !== 'cmd') return
    const { reqId, payload } = msg
    void (async () => {
      try {
        let result: unknown = null
        switch (payload.cmd) {
          case 'enqueue':
            await runEff(worker.enqueue(payload.sessionId))
            break
          case 'rescanAll':
            result = await runEff(worker.rescanAll())
            break
          case 'backfill':
            result = await runEff(worker.backfill({ userInitiated: payload.userInitiated === true }))
            break
          case 'getStatus':
            result = await runEff(worker.getStatus)
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

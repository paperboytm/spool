// Scan worker — the long-lived coordinator that drains a session
// queue, runs `scanSession` per item, and publishes change events.
//
// Implementation: Effect Scope A. Inside this module is Effect-shaped
// (Queue, Stream, PubSub, Ref, Scope). The boundary — IPC handlers
// in `packages/app/src/main/ipc/security.ts` — wraps `runFiber` /
// `runPromise` so renderers see plain Promise-shaped channels.
//
// Single-fiber by design (`concurrency: 1` on the queue stream).
// Better-sqlite3 is synchronous, so multiple parallel fibers compete
// for the DB lock and gain nothing. Backfill UX surfaces "session N
// of M" progress for the user.

import { Effect, Fiber, PubSub, Queue, Ref, Stream, Scope } from 'effect'
import type Database from 'better-sqlite3'
import type { RedactProvider } from '@spool-lab/redact'
import { scanSession, type ScanResult } from './scan.js'
import { listSessionsNeedingScan } from './repo.js'
import type { FindingsChange, ScanStatus } from './types.js'

export interface WorkerConfig {
  db: Database.Database
  providers: readonly RedactProvider[]
  /** Profile string for `providers`. The worker rejects mismatched
   *  pairs (you can't claim profile = 'regex@3,pf@1.5b' with only
   *  regexProvider in `providers`). */
  currentProfile: string
  /** Names of providers active in this profile. */
  providerNames: readonly string[]
}

export interface ScanWorker {
  /** Drop a session at the back of the queue. */
  enqueue: (sessionId: number) => Effect.Effect<void>
  /** Set every session's profile to NULL and enqueue them — used by
   *  "Rescan all" and by provider-set changes. */
  rescanAll: () => Effect.Effect<number>
  /** Enqueue every session whose scan_profile != currentProfile.
   *  Called once on boot. */
  backfill: () => Effect.Effect<number>
  /** Stream of change events. Translator in main process subscribes
   *  and forwards over IPC. */
  changes: Stream.Stream<FindingsChange>
  /** Current snapshot. UI polls via IPC. */
  getStatus: Effect.Effect<ScanStatus>
}

/** Build a worker as a Scoped effect: when the scope closes, the
 *  draining fiber is interrupted cleanly and the PubSub shuts down. */
export function makeScanWorker(
  config: WorkerConfig,
): Effect.Effect<ScanWorker, never, Scope.Scope> {
  return Effect.gen(function* () {
    const queue = yield* Queue.unbounded<number>()
    const events = yield* PubSub.unbounded<FindingsChange>()
    const statusRef = yield* Ref.make<ScanStatus>({
      queued: 0,
      scanning: null,
      backfillRemaining: 0,
      currentProfile: config.currentProfile,
    })

    const publish = (c: FindingsChange) => PubSub.publish(events, c).pipe(Effect.asVoid)

    const scanOne = (sessionId: number) =>
      Effect.gen(function* () {
        yield* Ref.update(statusRef, (s) => ({
          ...s,
          scanning: sessionId,
          queued: Math.max(0, s.queued - 1),
        }))
        const result: ScanResult | null = yield* scanSession(sessionId, {
          db: config.db,
          providers: config.providers,
          currentProfile: config.currentProfile,
          providerNames: config.providerNames,
          publish,
        }).pipe(
          Effect.catchAll((err) =>
            Effect.logError(`scanSession failed for ${sessionId}: ${err.reason}`, err).pipe(
              Effect.as(null),
            ),
          ),
        )
        yield* Ref.update(statusRef, (s) => ({
          ...s,
          scanning: null,
          backfillRemaining: Math.max(0, s.backfillRemaining - 1),
        }))
        return result
      })

    // The drain fiber runs for the worker's lifetime; Scope.addFinalizer
    // interrupts it when the runtime tears down.
    //
    // Throttle: yield 50ms between scans. better-sqlite3 is synchronous
    // so the DB lock is held for the full scanOne duration (~50-100ms
    // per session). Without a yield, a backfill of N sessions becomes
    // ~N*scanTime of uninterrupted lock contention — foreground reads
    // (listSessions, FTS search) get queued behind every scan. The
    // sleep gives the event loop a window to flush foreground IPC
    // handlers before grabbing the next session. Doubles backfill
    // duration but keeps the app responsive.
    const drain = Stream.fromQueue(queue).pipe(
      Stream.mapEffect(
        (sessionId: number) =>
          scanOne(sessionId).pipe(Effect.tap(() => Effect.sleep('50 millis'))),
        { concurrency: 1 },
      ),
      Stream.runDrain,
    )
    yield* Effect.forkScoped(drain)

    const enqueue = (sessionId: number) =>
      Effect.gen(function* () {
        yield* Queue.offer(queue, sessionId)
        yield* Ref.update(statusRef, (s) => ({ ...s, queued: s.queued + 1 }))
      })

    const rescanAll = () =>
      Effect.gen(function* () {
        // Cheap; better to do this outside a transaction so other
        // queries can interleave during long catalogs.
        const all = yield* Effect.sync(() =>
          config.db.prepare('SELECT id FROM sessions ORDER BY started_at DESC').all() as Array<{ id: number }>,
        )
        yield* Effect.sync(() =>
          config.db.prepare('UPDATE sessions SET scan_profile = NULL').run(),
        )
        yield* Ref.update(statusRef, (s) => ({ ...s, backfillRemaining: all.length }))
        for (const r of all) {
          yield* enqueue(r.id)
        }
        return all.length
      })

    const backfill = () =>
      Effect.gen(function* () {
        const stale = yield* Effect.sync(() =>
          listSessionsNeedingScan(config.db, config.currentProfile),
        )
        yield* Ref.update(statusRef, (s) => ({ ...s, backfillRemaining: stale.length }))
        for (const id of stale) {
          yield* enqueue(id)
        }
        return stale.length
      })

    return {
      enqueue,
      rescanAll,
      backfill,
      changes: Stream.fromPubSub(events),
      getStatus: Ref.get(statusRef),
    } satisfies ScanWorker
  })
}

/** Helper for tests / callers that want a complete drain promise
 *  (e.g. wait for the queue to empty after a backfill). */
export function waitForIdle(worker: ScanWorker): Effect.Effect<void> {
  return Effect.gen(function* () {
    while (true) {
      const s = yield* worker.getStatus
      if (s.queued === 0 && s.scanning === null && s.backfillRemaining === 0) return
      yield* Effect.sleep('25 millis')
    }
  })
}

// Re-export Fiber for callers that want to manage runtime lifecycle.
export { Fiber }

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
   *  regexProvider in `providers`).
   *
   *  Pass either a static string (test fixtures) or a thunk (prod —
   *  lets the profile track pref changes like `kindAllowlist` so
   *  toggling a kind triggers backfill via `listSessionsNeedingScan`
   *  on the next call). The worker resolves the thunk on every read
   *  rather than caching, so a pref save → SET_PREFS handler can
   *  invalidate sessions and immediately see them as stale. */
  currentProfile: string | (() => string)
  /** Names of providers active in this profile. */
  providerNames: readonly string[]
  /** Live accessor for the kind-level allowlist. Read on every scan
   *  (cheap — a Set lookup per match), so changing the preference
   *  takes effect on the next rescan without restarting the worker. */
  getKindAllowlist?: () => ReadonlySet<string>
}

function resolveProfile(config: WorkerConfig): string {
  return typeof config.currentProfile === 'function'
    ? config.currentProfile()
    : config.currentProfile
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
  /** Stream of finding change events. Translator in main process
   *  subscribes and forwards over IPC. */
  changes: Stream.Stream<FindingsChange>
  /** Stream of status updates — emitted on every queued / scanning /
   *  backfillRemaining mutation. Lets the UI replace polling with a
   *  push subscription. */
  statusChanges: Stream.Stream<ScanStatus>
  /** Current snapshot. UI uses this for the first read; subsequent
   *  updates land via `statusChanges`. */
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
    const statusEvents = yield* PubSub.unbounded<ScanStatus>()
    const statusRef = yield* Ref.make<ScanStatus>({
      queued: 0,
      scanning: null,
      backfillRemaining: 0,
      currentProfile: resolveProfile(config),
    })

    const publish = (c: FindingsChange) => PubSub.publish(events, c).pipe(Effect.asVoid)

    // Update statusRef AND publish the new snapshot so subscribers get
    // a push event for every mutation. One helper at the seam avoids
    // forgetting to publish from a future Ref.update site.
    const updateStatus = (f: (s: ScanStatus) => ScanStatus) =>
      Ref.update(statusRef, f).pipe(
        Effect.zipRight(Ref.get(statusRef)),
        Effect.flatMap((s) => PubSub.publish(statusEvents, s)),
        Effect.asVoid,
      )

    const scanOne = (sessionId: number) =>
      Effect.gen(function* () {
        yield* updateStatus((s) => ({
          ...s,
          scanning: sessionId,
          queued: Math.max(0, s.queued - 1),
        }))
        const result: ScanResult | null = yield* scanSession(sessionId, {
          db: config.db,
          providers: config.providers,
          currentProfile: resolveProfile(config),
          providerNames: config.providerNames,
          publish,
          ...(config.getKindAllowlist ? { kindAllowlist: config.getKindAllowlist() } : {}),
        }).pipe(
          Effect.catchAll((err) =>
            Effect.logError(`scanSession failed for ${sessionId}: ${err.reason}`, err).pipe(
              Effect.as(null),
            ),
          ),
        )
        yield* updateStatus((s) => ({
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
        yield* updateStatus((s) => ({ ...s, queued: s.queued + 1 }))
      })

    const rescanAll = () =>
      Effect.gen(function* () {
        // SELECT and UPDATE share one transaction so a concurrent sync
        // that inserts a new session can't slip between them — the
        // new row would otherwise miss the profile NULL pass AND be
        // omitted from `all`, leaving it silently skipped by the
        // drain fiber even though the user pressed "Rescan all". With
        // a transaction the worker either sees every session present
        // at the moment of the click, or sees the post-insert state
        // (in which case the new session participates).
        const all = yield* Effect.sync(() =>
          config.db.transaction(() => {
            const rows = config.db
              .prepare('SELECT id FROM sessions ORDER BY started_at DESC')
              .all() as Array<{ id: number }>
            config.db.prepare('UPDATE sessions SET scan_profile = NULL').run()
            return rows
          })(),
        )
        yield* updateStatus((s) => ({ ...s, backfillRemaining: all.length }))
        for (const r of all) {
          yield* enqueue(r.id)
        }
        return all.length
      })

    const backfill = () =>
      Effect.gen(function* () {
        // Re-resolve the profile each call so a SET_PREFS handler that
        // changed kindAllowlist sees the updated hash before invoking
        // backfill. Keep the per-call status snapshot in sync too.
        const profile = resolveProfile(config)
        yield* updateStatus((s) => ({ ...s, currentProfile: profile }))
        const stale = yield* Effect.sync(() =>
          listSessionsNeedingScan(config.db, profile),
        )
        yield* updateStatus((s) => ({ ...s, backfillRemaining: stale.length }))
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
      statusChanges: Stream.fromPubSub(statusEvents),
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

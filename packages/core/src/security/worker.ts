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
   *  Called on boot AND on every profile-affecting pref change
   *  (kindAllowlist toggle, PF on/off, etc.).
   *
   *  Treated as a fresh burst: any leftover items still in the queue
   *  from the previous burst are discarded (they were enqueued against
   *  an outdated profile; the current `listSessionsNeedingScan` call
   *  is the authoritative new work set). `backfillTotal` resets to the
   *  new stale-set size instead of sticky-maxing with the old burst's
   *  value, so the renderer's progress bar reflects the new work
   *  rather than the union of the two.
   *
   *  Pass `userInitiated: true` when the caller is a SET_PREFS / PF
   *  toggle handler so the renderer's busy→idle edge surfaces a
   *  "Scan complete" result banner the same way it does for the
   *  Rescan-all button. */
  backfill: (opts?: { userInitiated?: boolean }) => Effect.Effect<number>
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
      backfillTotal: 0,
      manualBurstInFlight: false,
      currentProfile: resolveProfile(config),
    })

    const publish = (c: FindingsChange) => PubSub.publish(events, c).pipe(Effect.asVoid)

    // Update statusRef AND publish the new snapshot so subscribers get
    // a push event for every mutation. One helper at the seam avoids
    // forgetting to publish from a future Ref.update site.
    //
    // `backfillTotal` is derived here so individual mutation sites
    // (enqueue / rescanAll / backfill / scanOne) don't have to
    // remember to bump it. The renderer's progress bar reads
    // `backfillRemaining + (scanning ? 1 : 0)` as the active count;
    // we track the high-water mark of that quantity since the last
    // full-idle state, and reset to 0 once everything drains. Survives
    // navigation: a user who switches tabs mid-burst and comes back
    // gets the true original total via `getStatus`, not the
    // remaining-at-remount-time approximation.
    const updateStatus = (f: (s: ScanStatus) => ScanStatus) =>
      Ref.update(statusRef, (prev) => {
        const after = f(prev)
        // High-water mark of *backfillRemaining alone*. Including the
        // scanning slot (br + 1 when scanning != null) bumped the
        // total by one every time a scanOne started, and dropped it
        // again when scanning went back to null between sessions —
        // turning the renderer's `(total - remaining)/total` into a
        // non-monotonic value that visibly rewound the progress bar
        // on every cross-session tick. backfillRemaining itself is
        // strictly monotonic (only decrements at scanOne end), so
        // anchoring the total to it makes the progress bar strictly
        // forward.
        const fullyIdle =
          after.backfillRemaining === 0 &&
          after.queued === 0 &&
          after.scanning === null
        const backfillTotal = fullyIdle
          ? 0
          : Math.max(prev.backfillTotal, after.backfillRemaining)
        // `manualBurstInFlight` rides along with the burst. The
        // worker.rescanAll() mutation flips it on; this wrapper
        // flips it off the instant the worker drains, so the
        // renderer's "your manual scan finished" detection never
        // sees a stale truth across burst boundaries.
        const manualBurstInFlight = fullyIdle ? false : after.manualBurstInFlight
        return { ...after, backfillTotal, manualBurstInFlight }
      }).pipe(
        Effect.zipRight(Ref.get(statusRef)),
        Effect.flatMap((s) => PubSub.publish(statusEvents, s)),
        Effect.asVoid,
      )

    // Burst-reset variant for backfill() (and any future caller that
    // means "start a fresh burst, discard whatever the previous one
    // had queued"). Two differences from updateStatus:
    //
    //   1. The `Math.max(prev.backfillTotal, after.backfillRemaining)`
    //      sticky guard is BYPASSED — the caller is declaring a brand-
    //      new burst, so its new `backfillRemaining` becomes the
    //      authoritative `backfillTotal`. Without this, a toggle-pref
    //      mid-scan would leave the renderer showing the OLD burst's
    //      total while the new burst's much smaller stale set drives
    //      the remaining count → progress bar visually pinned at
    //      ~100% for as long as the queue takes to drain.
    //
    //   2. The Effect Queue is drained synchronously. Items left in
    //      it were enqueued against the previous profile and were
    //      already accounted for in the OLD burst's
    //      backfillRemaining. With the new totals in force they'd
    //      keep `nowBusy = queued > 0` true (banner-stuck-at-100%
    //      problem) and waste regex-only scans on sessions whose
    //      profile already matches the current one.
    const resetBurst = (f: (s: ScanStatus) => ScanStatus) =>
      Effect.gen(function* () {
        yield* Queue.takeAll(queue)
        yield* Ref.update(statusRef, (prev) => {
          const after = f(prev)
          const fullyIdle =
            after.backfillRemaining === 0 &&
            after.queued === 0 &&
            after.scanning === null
          const backfillTotal = fullyIdle ? 0 : after.backfillRemaining
          const manualBurstInFlight = fullyIdle ? false : after.manualBurstInFlight
          return { ...after, backfillTotal, manualBurstInFlight }
        })
        const snap = yield* Ref.get(statusRef)
        yield* PubSub.publish(statusEvents, snap)
      })

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
        yield* updateStatus((s) => ({
          ...s,
          backfillRemaining: all.length,
          // Flag this as a user-initiated burst — the renderer
          // hangs its result-banner ACK off this field instead of
          // a click-local flag.
          manualBurstInFlight: true,
        }))
        for (const r of all) {
          yield* enqueue(r.id)
        }
        yield* Effect.annotateCurrentSpan('enqueued', all.length)
        return all.length
      }).pipe(Effect.withSpan('security.worker.rescan_all'))

    const backfill = (opts?: { userInitiated?: boolean }) =>
      Effect.gen(function* () {
        // Re-resolve the profile each call so a SET_PREFS handler that
        // changed kindAllowlist sees the updated hash before invoking
        // backfill.
        const profile = resolveProfile(config)
        const stale = yield* Effect.sync(() =>
          listSessionsNeedingScan(config.db, profile),
        )
        // Fresh burst: drain any leftover queue items (they belong to
        // a previous profile snapshot — see `resetBurst` notes), reset
        // queued/backfillRemaining/backfillTotal to this burst's stale
        // count, and stamp the user-initiated flag if applicable. The
        // wrapper bypasses the sticky-max guard so the renderer's
        // progress bar tracks the new burst, not the old.
        yield* resetBurst((s) => ({
          ...s,
          currentProfile: profile,
          queued: 0,
          backfillRemaining: stale.length,
          manualBurstInFlight: opts?.userInitiated === true,
        }))
        for (const id of stale) {
          yield* enqueue(id)
        }
        yield* Effect.annotateCurrentSpan('enqueued', stale.length)
        yield* Effect.annotateCurrentSpan('userInitiated', opts?.userInitiated === true)
        return stale.length
      }).pipe(Effect.withSpan('security.worker.backfill'))

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

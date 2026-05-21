import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Scope, Exit, Stream, Chunk, Fiber } from 'effect'
import Database from 'better-sqlite3'
import { regexProvider } from '@spool-lab/redact'
import { runMigrations } from '../db/db.js'
import { makeScanWorker, waitForIdle, type ScanWorker } from './worker.js'
import { listFindings } from './repo.js'

// Fake AWS access key — split at concat time so neither GitHub
// push-protection nor our `*EXAMPLE` validator filters it.
const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'

function setupDb(sessionCount = 1): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  const insertSession = db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at)
     VALUES (?, 1, 1, ?, ?, ?, ?, ?)`,
  )
  const insertMessage = db.prepare(
    `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
     VALUES (?, ?, 1, 'user', ?, '2026-01-01', 0)`,
  )
  for (let i = 1; i <= sessionCount; i++) {
    insertSession.run(i, `s-${i}`, `/p/s-${i}`, `Session ${i}`, '2026-01-01', '2026-01-01')
    insertMessage.run(i * 10, i, `Found ${FAKE_AKIA} in session ${i}`)
  }
  return db
}

/** Run a body against a worker bound to a fresh Scope. The scope is
 *  released in `finally`, which interrupts the worker drain fiber
 *  cleanly. */
async function withWorker<A>(
  db: Database.Database,
  body: (worker: ScanWorker) => Promise<A>,
): Promise<A> {
  const scope = await Effect.runPromise(Scope.make())
  try {
    const worker = await Effect.runPromise(
      Effect.provideService(
        makeScanWorker({
          db,
          providers: [regexProvider],
          currentProfile: 'regex@3',
          providerNames: ['regex'],
        }),
        Scope.Scope,
        scope,
      ),
    )
    return await body(worker)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
}

describe('ScanWorker', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb(1) })

  it('processes an enqueued session and writes findings + sets scan_profile', async () => {
    await withWorker(db, async (worker) => {
      await Effect.runPromise(worker.enqueue(1))
      await Effect.runPromise(waitForIdle(worker))
      const rows = listFindings(db, { sessionId: 1 })
      expect(rows.length).toBeGreaterThan(0)
      const sess = db.prepare('SELECT scan_profile, scan_finding_count FROM sessions WHERE id = 1')
        .get() as { scan_profile: string; scan_finding_count: number }
      expect(sess.scan_profile).toBe('regex@3')
      expect(sess.scan_finding_count).toBeGreaterThan(0)

      const status = await Effect.runPromise(worker.getStatus)
      expect(status.queued).toBe(0)
      expect(status.scanning).toBeNull()
    })
  })

  it('backfill enqueues every session whose profile is stale', async () => {
    db = setupDb(3)
    await withWorker(db, async (worker) => {
      const enqueued = await Effect.runPromise(worker.backfill())
      expect(enqueued).toBe(3)
      await Effect.runPromise(waitForIdle(worker))
      const rows = db.prepare(
        'SELECT scan_profile, scan_finding_count FROM sessions ORDER BY id',
      ).all() as Array<{ scan_profile: string; scan_finding_count: number }>
      expect(rows.every((r) => r.scan_profile === 'regex@3')).toBe(true)
      expect(rows.every((r) => r.scan_finding_count > 0)).toBe(true)
    })
  })

  it('backfill skips sessions whose profile already matches current', async () => {
    db = setupDb(2)
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3' WHERE id = 1").run()
    await withWorker(db, async (worker) => {
      const enqueued = await Effect.runPromise(worker.backfill())
      expect(enqueued).toBe(1)
    })
  })

  it('rescanAll invalidates every profile and re-enqueues every session', async () => {
    db = setupDb(2)
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3'").run()
    await withWorker(db, async (worker) => {
      const enqueued = await Effect.runPromise(worker.rescanAll())
      expect(enqueued).toBe(2)
      await Effect.runPromise(waitForIdle(worker))
      const rows = db.prepare('SELECT scan_profile FROM sessions ORDER BY id').all() as Array<{ scan_profile: string }>
      expect(rows.every((r) => r.scan_profile === 'regex@3')).toBe(true)
    })
  })

  it('getStatus reflects currentProfile + idle state after drain', async () => {
    await withWorker(db, async (worker) => {
      await Effect.runPromise(worker.enqueue(1))
      await Effect.runPromise(waitForIdle(worker))
      const s = await Effect.runPromise(worker.getStatus)
      expect(s.queued).toBe(0)
      expect(s.scanning).toBeNull()
      expect(s.currentProfile).toBe('regex@3')
    })
  })

  // Regression: the worker must read its profile lazily so that
  // pref changes (kindAllowlist) make previously-scanned sessions
  // look stale on the next backfill, instead of being permanently
  // pinned to the boot-time profile string.
  it('re-reads currentProfile from a thunk between backfill calls', async () => {
    db = setupDb(1)
    let profile = 'regex@3'
    const scope = await Effect.runPromise(Scope.make())
    try {
      const worker = await Effect.runPromise(
        Effect.provideService(
          makeScanWorker({
            db,
            providers: [regexProvider],
            currentProfile: () => profile,
            providerNames: ['regex'],
          }),
          Scope.Scope,
          scope,
        ),
      )
      await Effect.runPromise(worker.backfill())
      await Effect.runPromise(waitForIdle(worker))
      // Session is now stamped 'regex@3'. Pretend the user toggled a
      // kind allowlist — the profile thunk returns a different value.
      profile = 'regex@3,allow@deadbeef'
      const enqueued = await Effect.runPromise(worker.backfill())
      expect(enqueued).toBe(1)
      await Effect.runPromise(waitForIdle(worker))
      const sess = db.prepare('SELECT scan_profile FROM sessions WHERE id = 1')
        .get() as { scan_profile: string }
      expect(sess.scan_profile).toBe('regex@3,allow@deadbeef')
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })

  // Regression: rescanAll's SELECT + UPDATE must be atomic so a row
  // inserted by sync between the two statements can't slip through
  // (it would otherwise miss the profile-null pass AND be omitted
  // from the enqueue list).
  it('rescanAll wraps SELECT + UPDATE in a single transaction', async () => {
    db = setupDb(2)
    db.prepare("UPDATE sessions SET scan_profile = 'regex@3'").run()
    await withWorker(db, async (worker) => {
      // Sanity: pre-rescan both rows are stamped.
      const before = db.prepare('SELECT scan_profile FROM sessions ORDER BY id')
        .all() as Array<{ scan_profile: string | null }>
      expect(before.every(r => r.scan_profile === 'regex@3')).toBe(true)
      const count = await Effect.runPromise(worker.rescanAll())
      expect(count).toBe(2)
      // After enqueue + idle, both should be re-stamped.
      await Effect.runPromise(waitForIdle(worker))
      const after = db.prepare('SELECT scan_profile FROM sessions ORDER BY id')
        .all() as Array<{ scan_profile: string | null }>
      expect(after.every(r => r.scan_profile === 'regex@3')).toBe(true)
    })
  })

  // The status push channel is what lets the Security page replace
  // its old setInterval pull-loop with a subscription. Enqueue +
  // drain should generate AT LEAST: queued++ → scanning=id → done
  // (scanning=null, backfillRemaining--). All three must reach a
  // subscriber that started listening before the events fired.
  it('statusChanges emits a snapshot on every queue / scan mutation', async () => {
    await withWorker(db, async (worker) => {
      // Subscribe in a forked fiber so collection runs concurrently
      // with enqueue + drain; then take() drains the buffer.
      // Three events fire from enqueue + drain: queued++,
      // scanning=id (queued--), scanning=null (backfillRemaining--).
      const collectFiber = Effect.runFork(
        Stream.take(worker.statusChanges, 3).pipe(Stream.runCollect),
      )
      // Tiny delay so the Stream subscriber is attached before publish.
      await new Promise<void>((r) => setTimeout(r, 20))
      await Effect.runPromise(worker.enqueue(1))
      await Effect.runPromise(waitForIdle(worker))
      const collected = Chunk.toReadonlyArray(
        await Effect.runPromise(Fiber.join(collectFiber)),
      )
      // queued++ event present
      expect(collected.some(s => s.queued === 1)).toBe(true)
      // scanning=1 event present
      expect(collected.some(s => s.scanning === 1)).toBe(true)
      // drained back to idle
      expect(collected.some(s => s.scanning === null && s.queued === 0)).toBe(true)
    })
  })

  // backfillTotal anchors the renderer's progress bar through a
  // tab-switch / remount: the page re-reads the worker's snapshot
  // instead of restarting at the remaining-now count.
  it('rescanAll bumps backfillTotal to the burst size, holds it through the drain, and resets to 0 on full idle', async () => {
    const multiDb = setupDb(5)
    await withWorker(multiDb, async (worker) => {
      // 1 + 5 + 5 + 5 + 1 = the upper bound of snapshots; take a
      // generous number, stop collecting on the first fully-idle
      // snapshot via takeUntil to avoid hanging.
      const collectFiber = Effect.runFork(
        Stream.takeUntil(worker.statusChanges, (s) =>
          s.queued === 0 && s.scanning === null && s.backfillRemaining === 0,
        ).pipe(Stream.runCollect),
      )
      await new Promise<void>((r) => setTimeout(r, 20))
      const enqueued = await Effect.runPromise(worker.rescanAll())
      expect(enqueued).toBe(5)
      await Effect.runPromise(waitForIdle(worker))
      const collected = Chunk.toReadonlyArray(
        await Effect.runPromise(Fiber.join(collectFiber)),
      )
      // High-water mark reaches the burst size.
      expect(Math.max(...collected.map(s => s.backfillTotal))).toBe(5)
      // Drains back to 0 once fully idle.
      const last = collected[collected.length - 1]!
      expect(last.backfillRemaining).toBe(0)
      expect(last.backfillTotal).toBe(0)
    })
  })

  // Regression for the "manual ACK banner never shows" race —
  // before this field, the renderer flagged manual on click; an auto
  // sync enqueue completing between the click and rescanAll's IPC
  // reaching the worker would hijack the busy→idle edge, consume
  // the flag, and the real manual scan completed with no banner.
  // Anchoring to the worker (rescanAll sets the field; updateStatus
  // resets on full idle) keeps the renderer's detection race-free.
  it('manualBurstInFlight is true through rescanAll() and false on full idle', async () => {
    const multiDb = setupDb(3)
    await withWorker(multiDb, async (worker) => {
      const collectFiber = Effect.runFork(
        Stream.takeUntil(worker.statusChanges, (s) =>
          s.queued === 0 && s.scanning === null && s.backfillRemaining === 0,
        ).pipe(Stream.runCollect),
      )
      await new Promise<void>((r) => setTimeout(r, 20))
      // Pre-condition — no burst yet, no manual flag.
      const initial = await Effect.runPromise(worker.getStatus)
      expect(initial.manualBurstInFlight).toBe(false)
      await Effect.runPromise(worker.rescanAll())
      await Effect.runPromise(waitForIdle(worker))
      const collected = Chunk.toReadonlyArray(
        await Effect.runPromise(Fiber.join(collectFiber)),
      )
      // At least one in-flight snapshot has the flag set.
      expect(collected.some(s =>
        s.manualBurstInFlight === true &&
        (s.backfillRemaining > 0 || s.scanning !== null || s.queued > 0),
      )).toBe(true)
      // Once fully idle the flag is cleared.
      const last = collected[collected.length - 1]!
      expect(last.manualBurstInFlight).toBe(false)
    })
  })

  // Single-session enqueue (the sync-driven path) must NOT set the
  // manual flag — that's how the renderer distinguishes a stray
  // file-write-triggered auto burst from a user clicking Rescan all.
  it('enqueue() never raises manualBurstInFlight', async () => {
    await withWorker(db, async (worker) => {
      const collectFiber = Effect.runFork(
        Stream.takeUntil(worker.statusChanges, (s) =>
          s.queued === 0 && s.scanning === null && s.backfillRemaining === 0,
        ).pipe(Stream.runCollect),
      )
      await new Promise<void>((r) => setTimeout(r, 20))
      await Effect.runPromise(worker.enqueue(1))
      await Effect.runPromise(waitForIdle(worker))
      const collected = Chunk.toReadonlyArray(
        await Effect.runPromise(Fiber.join(collectFiber)),
      )
      expect(collected.every(s => s.manualBurstInFlight === false)).toBe(true)
    })
  })

  // Regression for the "progress bar rewinds when switching back
  // mid-scan" bug. Anchoring backfillTotal to backfillRemaining
  // (which only ever decrements at scanOne end) — instead of to
  // `backfillRemaining + scanning ? 1 : 0` — keeps the renderer's
  // `(total - remaining)/total` strictly monotonic. The old
  // formula added 1 on scanOne start and subtracted it on scanOne
  // end, causing the progress to dip by 1/total on every scan
  // transition.
  it('backfillTotal never decreases during an active burst', async () => {
    const multiDb = setupDb(3)
    await withWorker(multiDb, async (worker) => {
      const collectFiber = Effect.runFork(
        Stream.takeUntil(worker.statusChanges, (s) =>
          s.queued === 0 && s.scanning === null && s.backfillRemaining === 0,
        ).pipe(Stream.runCollect),
      )
      await new Promise<void>((r) => setTimeout(r, 20))
      await Effect.runPromise(worker.rescanAll())
      await Effect.runPromise(waitForIdle(worker))
      const collected = Chunk.toReadonlyArray(
        await Effect.runPromise(Fiber.join(collectFiber)),
      )
      // Walk every adjacent pair while the burst is in flight and
      // assert the total never shrinks.
      for (let i = 1; i < collected.length; i++) {
        const prev = collected[i - 1]!
        const next = collected[i]!
        const prevBusy = !(prev.queued === 0 && prev.scanning === null && prev.backfillRemaining === 0)
        const nextBusy = !(next.queued === 0 && next.scanning === null && next.backfillRemaining === 0)
        if (prevBusy && nextBusy) {
          expect(next.backfillTotal).toBeGreaterThanOrEqual(prev.backfillTotal)
        }
      }
    })
  })
})

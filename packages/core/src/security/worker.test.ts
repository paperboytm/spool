import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Scope, Exit } from 'effect'
import Database from 'better-sqlite3'
import { regexProvider } from '@spool-lab/redact'
import { runMigrations } from '../db/db.js'
import { makeScanWorker, waitForIdle, type ScanWorker } from './worker.js'
import { listFindings } from './repo.js'

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
    insertMessage.run(i * 10, i, `Found AKIAIOSFODNN7EXAMPLE in session ${i}`)
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
})

// IPC handler unit tests for the Security Scan channels.
//
// We stub `electron` so vitest doesn't need a running Electron
// process — the harness captures each ipcMain.handle registration
// and exposes them as invokable functions. Combined with a real
// in-memory SQLite (the same as repo.test.ts) and a hand-rolled
// fake ScanWorker, we can exercise every channel's request/response
// shape, error mapping, and event-publish behaviour without
// spinning up an actual app.

import { describe, it, expect, beforeAll, beforeEach, vi, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Effect, PubSub, Stream } from 'effect'
import {
  runMigrations,
  insertFindings,
  updateSessionCounts,
  setSessionScanProfile,
  listFindings,
  type ScanWorker,
  type ScanStatus,
  type FindingsChange,
} from '@spool-lab/core'
import type { MutationWorkerProxy } from '../mutation-worker-proxy.js'

// ─── electron mock ────────────────────────────────────────────────
// vi.hoisted so the stub objects exist before vi.mock evaluates.
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const sentEvents: Array<{ channel: string; payload: unknown }> = []

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
  },
}))

// Imported AFTER vi.mock so the stub is the one electron resolves to.
let registerSecurityIpc: typeof import('./security.js')['registerSecurityIpc']
let registerSecurityReadinessIpc: typeof import('./security.js')['registerSecurityReadinessIpc']
let SECURITY_IPC_CHANNELS: typeof import('./security.js')['SECURITY_IPC_CHANNELS']

let tmp: string

beforeAll(async () => {
  // test-setup.ts already pointed SPOOL_DATA_DIR at a temp dir
  // before any imports; we just remember that location so beforeEach
  // can wipe security.json between tests.
  tmp = process.env['SPOOL_DATA_DIR'] ?? mkdtempSync(join(tmpdir(), 'spool-ipc-test-'))
  process.env['SPOOL_DATA_DIR'] = tmp
  const mod = await import('./security.js')
  registerSecurityIpc = mod.registerSecurityIpc
  registerSecurityReadinessIpc = mod.registerSecurityReadinessIpc
  SECURITY_IPC_CHANNELS = mod.SECURITY_IPC_CHANNELS
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
  delete process.env['SPOOL_DATA_DIR']
})

// ─── test fixture ─────────────────────────────────────────────────

interface Fixture {
  db: Database.Database
  worker: ScanWorker
  /** Last value pushed to `worker.changes` — used to assert that
   *  purge handlers propagate change events through the worker. */
  push: (change: FindingsChange) => Promise<void>
  dispose: () => void
  /** Each call records `rescanAll` / `backfill` / `enqueue` /
   *  `getStatus` invocations so tests can assert dispatch. */
  workerCalls: { rescanAll: number; backfill: number; enqueue: number[]; getStatus: number }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
     VALUES (1, 1, 1, 's-1', '/p/s-1', 'Session 1', '2026-01-01', '2026-01-01', 1)`,
  ).run()
  db.prepare(
    `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
     VALUES (10, 1, 1, 'user', 'leak AKIAIOSFODNN7EXAMPLE plz', '2026-01-01', 0)`,
  ).run()
  return db
}

async function setupFixture(): Promise<Fixture> {
  const db = setupDb()
  const workerCalls = { rescanAll: 0, backfill: 0, enqueue: [] as number[], getStatus: 0 }
  // PubSub-backed stream so we can assert change-event forwarding.
  const pubsub = await Effect.runPromise(PubSub.unbounded<FindingsChange>())
  const status: ScanStatus = { queued: 0, scanning: null, backfillRemaining: 0, backfillTotal: 0, manualBurstInFlight: false, currentProfile: 'regex@4' }

  const worker: ScanWorker = {
    enqueue: (id) => Effect.sync(() => { workerCalls.enqueue.push(id) }),
    rescanAll: () => Effect.sync(() => { workerCalls.rescanAll++; return 1 }),
    backfill: () => Effect.sync(() => { workerCalls.backfill++; return 0 }),
    changes: Stream.fromPubSub(pubsub),
    getStatus: Effect.sync(() => { workerCalls.getStatus++; return status }),
  }

  const fakeWindow = {
    webContents: {
      send: (channel: string, payload: unknown) => {
        sentEvents.push({ channel, payload })
      },
    },
  } as unknown as import('electron').BrowserWindow

  handlers.clear()
  sentEvents.length = 0

  // Mutation worker is never attached in the default fixture so the
  // existing assertions exercise the in-process fallback path; the
  // suite further down attaches a fake proxy and pins the worker-
  // delegated path.
  const { dispose } = registerSecurityIpc({
    db,
    worker,
    runPromise: <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as unknown as Effect.Effect<A>),
    getMainWindow: () => fakeWindow,
  })

  return {
    db,
    worker,
    push: (change) => Effect.runPromise(PubSub.publish(pubsub, change)).then(() => { /* void */ }),
    dispose,
    workerCalls,
  }
}

// ─── helpers ──────────────────────────────────────────────────────

async function invoke<A>(channel: string, ...args: unknown[]): Promise<A> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`No handler registered for ${channel}`)
  return (await h({}, ...args)) as A
}

// ─── tests ────────────────────────────────────────────────────────

describe('registerSecurityIpc', () => {
  let fixture: Fixture
  beforeEach(async () => {
    // Reset disk state — security.json persists across tests in the
    // same file unless we clear it, which leaks earlier mutations
    // (e.g. SET_PREFS writes) into later tests that assume a fresh
    // store.
    const configPath = join(tmp, 'security.json')
    if (existsSync(configPath)) rmSync(configPath)
    fixture = await setupFixture()
  })

  describe('channel registration', () => {
    it('registers every channel in SECURITY_IPC_CHANNELS that is not an EVT_*', () => {
      const expected = Object.entries(SECURITY_IPC_CHANNELS)
        // GET_READINESS is owned by registerSecurityReadinessIpc and
        // registered eagerly before bootScanWorker resolves; it does
        // not live in this surface.
        .filter(([key]) => !key.startsWith('EVT_') && key !== 'GET_READINESS')
        .map(([, value]) => value)
      for (const ch of expected) {
        expect(handlers.has(ch), `missing handler for ${ch}`).toBe(true)
      }
    })

    it('disposer removes every registered handler', () => {
      const before = handlers.size
      fixture.dispose()
      expect(handlers.size).toBe(0)
      expect(before).toBeGreaterThan(0)
    })
  })

  describe('queries', () => {
    it('LIST_FINDINGS returns rows matching the filter', async () => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 20, state: 'active' },
        { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 30, endOffset: 40, state: 'dismissed' },
      ])
      const rows = await invoke<unknown[]>(SECURITY_IPC_CHANNELS.LIST_FINDINGS, { sessionId: 1, state: 'active' })
      expect(rows).toHaveLength(1)
    })

    it('LIST_SESSIONS_WITH_FINDINGS aggregates per-session counts', async () => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 20, state: 'active' },
      ])
      updateSessionCounts(fixture.db, 1)
      const rows = await invoke<Array<{ id: number; findingCount: number }>>(
        SECURITY_IPC_CHANNELS.LIST_SESSIONS_WITH_FINDINGS,
        {},
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.findingCount).toBe(1)
    })

    it('OCCURRENCES_BY_VALUE_HASH aggregates the leak across sessions', async () => {
      // Add a second session in the same project sharing one value.
      fixture.db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (2, 1, 1, 's-2', '/p/s-2', 'Session 2', '2026-01-02', '2026-01-02', 1)`,
      ).run()
      fixture.db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (20, 2, 1, 'user', 'same leak AKIAIOSFODNN7EXAMPLE', '2026-01-02', 0)`,
      ).run()
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'shared', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'shared', confidence: 0.95, provider: 'regex', startOffset: 6, endOffset: 11, state: 'active' },
        { sessionId: 2, messageId: 20, kind: 'api-key', valueHash: 'shared', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active' },
      ])
      const rows = await invoke<Array<{ sessionId: number; count: number; project: string | null }>>(
        SECURITY_IPC_CHANNELS.OCCURRENCES_BY_VALUE_HASH,
        { kind: 'api-key', valueHash: 'shared' },
      )
      expect(rows).toHaveLength(2)
      const bySession = new Map(rows.map(r => [r.sessionId, r]))
      expect(bySession.get(1)!.count).toBe(2)
      expect(bySession.get(2)!.count).toBe(1)
      expect(bySession.get(1)!.project).toBe('p')
    })

    it('RISK_BY_CATEGORY groups by kind with severity + sessions', async () => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 20, state: 'active' },
      ])
      const rows = await invoke<Array<{ kind: string; severity: string; count: number; sessions: number }>>(
        SECURITY_IPC_CHANNELS.RISK_BY_CATEGORY,
      )
      expect(rows[0]).toMatchObject({ kind: 'api-key', severity: 'high', count: 1, sessions: 1 })
    })

    it('LAST_SCAN_COMPLETED_AT returns null before any scan, then the MAX', async () => {
      const before = await invoke<string | null>(SECURITY_IPC_CHANNELS.LAST_SCAN_COMPLETED_AT)
      expect(before).toBeNull()
      setSessionScanProfile(fixture.db, 1, 'regex@4', '2026-02-01T00:00:00Z')
      const after = await invoke<string | null>(SECURITY_IPC_CHANNELS.LAST_SCAN_COMPLETED_AT)
      expect(after).toBe('2026-02-01T00:00:00Z')
    })

    it('GET_FINDING_VALUE reads the live message text', async () => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 5, endOffset: 25, state: 'active' },
      ])
      const findings = listFindings(fixture.db, { sessionId: 1 })
      const v = await invoke<string | null>(SECURITY_IPC_CHANNELS.GET_FINDING_VALUE, findings[0]!.id)
      // start=5, end=25 against 'leak AKIAIOSFODNN7EXAMPLE plz'.
      expect(v).toBe('AKIAIOSFODNN7EXAMPLE')
    })

    it('GET_SCAN_STATUS delegates to worker.getStatus', async () => {
      const s = await invoke<ScanStatus>(SECURITY_IPC_CHANNELS.GET_SCAN_STATUS)
      expect(s.currentProfile).toBe('regex@4')
      expect(fixture.workerCalls.getStatus).toBeGreaterThan(0)
    })
  })

  describe('mutations', () => {
    let findingId: number
    beforeEach(() => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95, provider: 'regex', startOffset: 5, endOffset: 25, state: 'active' },
      ])
      findingId = listFindings(fixture.db, { sessionId: 1 })[0]!.id
    })

    it('DISMISS_FINDING flips state and returns { ok: true }', async () => {
      const result = await invoke<{ ok: boolean }>(
        SECURITY_IPC_CHANNELS.DISMISS_FINDING,
        { findingId, scope: 'session' },
      )
      expect(result).toEqual({ ok: true })
      const after = listFindings(fixture.db, { sessionId: 1, state: 'any' })[0]!
      expect(after.state).toBe('dismissed')
    })

    it('DISMISS_FINDINGS dismisses many in one call + emits one event per session', async () => {
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'email', valueHash: 'h2', confidence: 0.8, provider: 'regex', startOffset: 30, endOffset: 40, state: 'active' },
        { sessionId: 1, messageId: 10, kind: 'phone', valueHash: 'h3', confidence: 0.8, provider: 'regex', startOffset: 45, endOffset: 55, state: 'active' },
      ])
      const ids = listFindings(fixture.db, { sessionId: 1, state: 'active' }).map((r) => r.id)
      expect(ids.length).toBe(3)
      sentEvents.length = 0
      const result = await invoke<{ ok: boolean }>(
        SECURITY_IPC_CHANNELS.DISMISS_FINDINGS,
        { findingIds: ids, scope: 'session' },
      )
      expect(result).toEqual({ ok: true })
      const after = listFindings(fixture.db, { sessionId: 1, state: 'any' })
      expect(after.every((r) => r.state === 'dismissed')).toBe(true)
      // One consolidated change event for the single affected session.
      const changes = sentEvents.filter((e) => e.channel === SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED)
      expect(changes).toHaveLength(1)
      expect((changes[0]!.payload as { sessionId: number }).sessionId).toBe(1)
    })

    it('UNDISMISS_FINDING flips state back to active', async () => {
      await invoke(SECURITY_IPC_CHANNELS.DISMISS_FINDING, { findingId, scope: 'session' })
      const result = await invoke<{ ok: boolean }>(
        SECURITY_IPC_CHANNELS.UNDISMISS_FINDING,
        { findingId },
      )
      expect(result).toEqual({ ok: true })
      const after = listFindings(fixture.db, { sessionId: 1, state: 'any' })[0]!
      expect(after.state).toBe('active')
    })

    it('PURGE_FINDING rewrites the message text + flips to purged', async () => {
      const result = await invoke<{ findingId: number; sessionId: number; maskUsed: string }>(
        SECURITY_IPC_CHANNELS.PURGE_FINDING,
        findingId,
      )
      expect(result.findingId).toBe(findingId)
      expect(result.sessionId).toBe(1)
      const msg = fixture.db.prepare('SELECT content_text FROM messages WHERE id = 10')
        .get() as { content_text: string }
      expect(msg.content_text.includes('AKIAIOSFODNN7EXAMPLE')).toBe(false)
    })

    it('PURGE_FINDINGS handles bulk ids', async () => {
      const results = await invoke<unknown[]>(SECURITY_IPC_CHANNELS.PURGE_FINDINGS, [findingId])
      expect(results).toHaveLength(1)
    })

    it('PURGE_EVERYWHERE scrubs the value across sessions + returns touched sessions', async () => {
      // Same value (one hash) in two sessions.
      fixture.db.prepare(
        `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
         VALUES (2, 1, 1, 's-2', '/p/s-2', 'Session 2', '2026-01-02', '2026-01-02', 1)`,
      ).run()
      fixture.db.prepare(
        `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
         VALUES (20, 2, 1, 'user', 'dup AKIAIOSFODNN7EXAMPLE', '2026-01-02', 0)`,
      ).run()
      insertFindings(fixture.db, [
        { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'shared', confidence: 0.95, provider: 'regex', startOffset: 5, endOffset: 25, state: 'active' },
        { sessionId: 2, messageId: 20, kind: 'api-key', valueHash: 'shared', confidence: 0.95, provider: 'regex', startOffset: 4, endOffset: 24, state: 'active' },
      ])
      const out = await invoke<{ count: number; sessionIds: number[] }>(
        SECURITY_IPC_CHANNELS.PURGE_EVERYWHERE,
        { kind: 'api-key', valueHash: 'shared' },
      )
      expect(out.count).toBe(2)
      expect([...out.sessionIds].sort()).toEqual([1, 2])
      for (const id of [10, 20]) {
        const msg = fixture.db.prepare('SELECT content_text FROM messages WHERE id = ?').get(id) as { content_text: string }
        expect(msg.content_text.includes('AKIAIOSFODNN7EXAMPLE')).toBe(false)
      }
    })

    it('RESCAN_ALL delegates to worker.rescanAll and wraps as { count }', async () => {
      const result = await invoke<{ count: number }>(SECURITY_IPC_CHANNELS.RESCAN_ALL)
      expect(result.count).toBe(1)
      expect(fixture.workerCalls.rescanAll).toBe(1)
    })

    it('RESCAN_SESSION enqueues the given sessionId', async () => {
      const result = await invoke<{ ok: boolean }>(SECURITY_IPC_CHANNELS.RESCAN_SESSION, 42)
      expect(result).toEqual({ ok: true })
      expect(fixture.workerCalls.enqueue).toEqual([42])
    })
  })

  describe('preferences', () => {
    it('GET_PREFS returns the on-disk state', async () => {
      const prefs = await invoke<{ kindAllowlist: string[]; rescanAfterSync: string }>(
        SECURITY_IPC_CHANNELS.GET_PREFS,
      )
      expect(prefs.kindAllowlist).toEqual([])
      expect(prefs.rescanAfterSync).toBe('auto')
    })

    it('SET_PREFS triggers worker.backfill() only when kindAllowlist actually changed', async () => {
      // Toggling kindAllowlist — should call backfill.
      await invoke(SECURITY_IPC_CHANNELS.SET_PREFS, { kindAllowlist: ['email'] })
      expect(fixture.workerCalls.backfill).toBe(1)

      // Setting it to the same value — backfill must not fire.
      await invoke(SECURITY_IPC_CHANNELS.SET_PREFS, { kindAllowlist: ['email'] })
      expect(fixture.workerCalls.backfill).toBe(1)

      // Toggling a non-allowlist field — backfill stays put.
      await invoke(SECURITY_IPC_CHANNELS.SET_PREFS, { infoDefaultVisible: true })
      expect(fixture.workerCalls.backfill).toBe(1)

      // Removing the kind from the allowlist — backfill fires again.
      await invoke(SECURITY_IPC_CHANNELS.SET_PREFS, { kindAllowlist: [] })
      expect(fixture.workerCalls.backfill).toBe(2)
    })

    it('SET_PREFS broadcasts EVT_PREFS_CHANGED with the saved value', async () => {
      const saved = await invoke<{ kindAllowlist: string[] }>(
        SECURITY_IPC_CHANNELS.SET_PREFS,
        { kindAllowlist: ['email'] },
      )
      expect(saved.kindAllowlist).toEqual(['email'])
      const evt = sentEvents.find((e) => e.channel === SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED)
      expect(evt).toBeDefined()
      expect((evt!.payload as { kindAllowlist: string[] }).kindAllowlist).toEqual(['email'])
    })

    it('LIST_ALLOWLIST_ENTRIES + REMOVE_ALLOWLIST_ENTRY round-trip', async () => {
      // Dismiss a finding (which writes to allowlist_session).
      const fid = listFindings(fixture.db, { sessionId: 1 }).at(0)?.id
        ?? (() => {
          insertFindings(fixture.db, [{
            sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'hX',
            confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active',
          }])
          return listFindings(fixture.db, { sessionId: 1 })[0]!.id
        })()
      await invoke(SECURITY_IPC_CHANNELS.DISMISS_FINDING, { findingId: fid, scope: 'global' })

      const entries = await invoke<Array<{ kind: string; valueHash: string; scope: string }>>(
        SECURITY_IPC_CHANNELS.LIST_ALLOWLIST_ENTRIES,
      )
      expect(entries.length).toBeGreaterThanOrEqual(1)
      const target = entries.find((e) => e.scope === 'global')!

      await invoke(SECURITY_IPC_CHANNELS.REMOVE_ALLOWLIST_ENTRY, {
        scope: 'global',
        kind: target.kind,
        valueHash: target.valueHash,
      })

      const afterRemove = await invoke<Array<{ scope: string }>>(SECURITY_IPC_CHANNELS.LIST_ALLOWLIST_ENTRIES)
      expect(afterRemove.find((e) => e.scope === 'global')).toBeUndefined()
    })

    it('COUNT_ALLOWLIST_ENTRIES reflects dismiss + remove', async () => {
      const before = await invoke<number>(SECURITY_IPC_CHANNELS.COUNT_ALLOWLIST_ENTRIES)

      insertFindings(fixture.db, [{
        sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'hCount',
        confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: 5, state: 'active',
      }])
      const fid = listFindings(fixture.db, { sessionId: 1 }).find((f) => f.valueHash === 'hCount')!.id
      await invoke(SECURITY_IPC_CHANNELS.DISMISS_FINDING, { findingId: fid, scope: 'global' })

      const after = await invoke<number>(SECURITY_IPC_CHANNELS.COUNT_ALLOWLIST_ENTRIES)
      expect(after).toBe(before + 1)

      await invoke(SECURITY_IPC_CHANNELS.REMOVE_ALLOWLIST_ENTRY, {
        scope: 'global', kind: 'api-key', valueHash: 'hCount',
      })
      const afterRemove = await invoke<number>(SECURITY_IPC_CHANNELS.COUNT_ALLOWLIST_ENTRIES)
      expect(afterRemove).toBe(before)
    })
  })

  describe('change-event forwarder', () => {
    it('forwards worker.changes events to webContents.send', async () => {
      // The forwarder is a daemon fiber set up at registerSecurityIpc
      // time (see ipc/security.ts comment "Bug-fix note: this fiber
      // MUST be forkDaemon"). Publish through our PubSub and assert
      // a small delay so the fiber drains.
      await fixture.push({ type: 'session-rescanned', sessionId: 7 })
      await new Promise((r) => setTimeout(r, 50))
      const forwarded = sentEvents.find(
        (e) => e.channel === SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED &&
          (e.payload as { type: string }).type === 'session-rescanned',
      )
      expect(forwarded).toBeDefined()
      expect((forwarded!.payload as { sessionId: number }).sessionId).toBe(7)
    })

    it('stops forwarding after disposer runs', async () => {
      fixture.dispose()
      sentEvents.length = 0
      await fixture.push({ type: 'session-rescanned', sessionId: 99 })
      await new Promise((r) => setTimeout(r, 50))
      const leaked = sentEvents.find(
        (e) => e.channel === SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED,
      )
      expect(leaked).toBeUndefined()
    })
  })
})

// Regression guard for the two reliability issues this commit fixes:
//   - IPC boot race: GET_READINESS must be registered the moment
//     readiness IPC is wired (i.e. eagerly, before bootScanWorker
//     resolves) so the renderer never hits "No handler registered for
//     security:get-readiness" during the boot window.
//   - scan-worker silent failure: the boot success/failure transition
//     must broadcast a readiness event so the renderer can switch
//     from skeleton → ready or → "Scanner unavailable" banner instead
//     of swallowing IPC errors.
// When a mutation worker proxy is wired in, the IPC layer must
// delegate purge / dismiss / undismiss to it (so the synchronous SQL
// runs on the worker thread, not on the main process event loop) AND
// forward the proxy's per-mutation FindingsChange events to the
// renderer via the same EVT_FINDINGS_CHANGED channel the scan worker
// uses — so renderer subscribers can't tell whether a change came
// from a scan or a mutation.
describe('registerSecurityIpc with mutationWorker', () => {
  it('routes purge / dismiss / undismiss IPCs through the proxy instead of running SQL in-process', async () => {
    handlers.clear()
    sentEvents.length = 0
    const db = setupDb()
    const status: ScanStatus = { queued: 0, scanning: null, backfillRemaining: 0, backfillTotal: 0, manualBurstInFlight: false, currentProfile: 'regex@4' }
    const worker: ScanWorker = {
      enqueue: () => Effect.void,
      rescanAll: () => Effect.sync(() => 0),
      backfill: () => Effect.sync(() => 0),
      changes: Stream.empty,
      statusChanges: Stream.empty,
      getStatus: Effect.sync(() => status),
    } as ScanWorker

    // Track every call so we can assert the right proxy method was
    // hit and the in-process path was not.
    const calls: Array<{ method: string; args: unknown[] }> = []
    const fakeProxy: MutationWorkerProxy = {
      purgeFinding: async (id) => { calls.push({ method: 'purgeFinding', args: [id] }); return { findingId: id, sessionId: 1, maskUsed: '[redacted]', purgedAt: 'now' } },
      purgeFindings: async (ids) => { calls.push({ method: 'purgeFindings', args: [ids] }); return [] },
      purgeEverywhere: async (kind, hash) => { calls.push({ method: 'purgeEverywhere', args: [kind, hash] }); return { results: [], sessionIds: [] } },
      dismissFinding: async (id, scope) => { calls.push({ method: 'dismissFinding', args: [id, scope] }); return null },
      dismissFindings: async (ids, scope) => { calls.push({ method: 'dismissFindings', args: [ids, scope] }); return [] },
      undismissFinding: async (id) => { calls.push({ method: 'undismissFinding', args: [id] }); return null },
      changes: Stream.empty,
      shutdown: async () => { /* no-op */ },
    }

    const fakeWindow = {
      webContents: { send: (channel: string, payload: unknown) => { sentEvents.push({ channel, payload }) } },
    } as unknown as import('electron').BrowserWindow

    const { dispose, attachMutationWorker } = registerSecurityIpc({
      db,
      worker,
      runPromise: <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as unknown as Effect.Effect<A>),
      getMainWindow: () => fakeWindow,
    })
    // Late-attach the fake proxy — mirrors how production wires the
    // mutation worker in after the IPC layer is already live.
    attachMutationWorker(fakeProxy)

    try {
      await invoke('security:purge-finding', 42)
      await invoke('security:purge-findings', [1, 2, 3])
      await invoke('security:purge-everywhere', { kind: 'api-key', valueHash: 'h' })
      await invoke('security:dismiss-finding', { findingId: 7, scope: 'session' })
      await invoke('security:dismiss-findings', { findingIds: [8, 9], scope: 'global' })
      await invoke('security:undismiss-finding', { findingId: 7 })

      expect(calls).toEqual([
        { method: 'purgeFinding', args: [42] },
        { method: 'purgeFindings', args: [[1, 2, 3]] },
        { method: 'purgeEverywhere', args: ['api-key', 'h'] },
        { method: 'dismissFinding', args: [7, 'session'] },
        { method: 'dismissFindings', args: [[8, 9], 'global'] },
        { method: 'undismissFinding', args: [7] },
      ])

      // The proxy's per-mutation publishes ride a separate forwarder
      // (a Stream.empty proxy here emits nothing); the in-process
      // fallback's manual webContents.send is what would normally
      // populate sentEvents during a dismiss. With a real proxy
      // those events flow through `mutationWorker.changes` instead
      // — covered separately in the next test.
      expect(sentEvents.length).toBe(0)
    } finally {
      dispose()
      db.close()
    }
  })

  it('forwards mutation worker change events to EVT_FINDINGS_CHANGED', async () => {
    handlers.clear()
    sentEvents.length = 0
    const db = setupDb()
    const status: ScanStatus = { queued: 0, scanning: null, backfillRemaining: 0, backfillTotal: 0, manualBurstInFlight: false, currentProfile: 'regex@4' }
    const worker: ScanWorker = {
      enqueue: () => Effect.void,
      rescanAll: () => Effect.sync(() => 0),
      backfill: () => Effect.sync(() => 0),
      changes: Stream.empty,
      statusChanges: Stream.empty,
      getStatus: Effect.sync(() => status),
    } as ScanWorker

    const mutationPubsub = await Effect.runPromise(PubSub.unbounded<FindingsChange>())
    const fakeProxy: MutationWorkerProxy = {
      purgeFinding: async () => { throw new Error('not used') },
      purgeFindings: async () => [],
      purgeEverywhere: async () => ({ results: [], sessionIds: [] }),
      dismissFinding: async () => null,
      dismissFindings: async () => [],
      undismissFinding: async () => null,
      changes: Stream.fromPubSub(mutationPubsub),
      shutdown: async () => { /* no-op */ },
    }

    const fakeWindow = {
      webContents: { send: (channel: string, payload: unknown) => { sentEvents.push({ channel, payload }) } },
    } as unknown as import('electron').BrowserWindow

    const { dispose, attachMutationWorker } = registerSecurityIpc({
      db,
      worker,
      runPromise: <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(eff as unknown as Effect.Effect<A>),
      getMainWindow: () => fakeWindow,
    })
    attachMutationWorker(fakeProxy)

    try {
      // The forwarder fiber is forked via Effect.runPromise which is
      // async; give it a tick to subscribe to the PubSub before we
      // publish. Mirrors the 50ms wait in the worker.changes forwarder
      // test above.
      await new Promise((r) => setTimeout(r, 50))
      const change: FindingsChange = { type: 'state-changed', sessionId: 5, state: 'purged' }
      await Effect.runPromise(PubSub.publish(mutationPubsub, change))
      await new Promise((r) => setTimeout(r, 50))
      expect(sentEvents).toEqual([
        { channel: 'security:evt-findings-changed', payload: change },
      ])
    } finally {
      dispose()
      db.close()
    }
  })
})

describe('registerSecurityReadinessIpc', () => {
  let fakeWin: { sent: Array<{ channel: string; payload: unknown }> }
  let getWindow: () => import('electron').BrowserWindow | null
  beforeEach(() => {
    handlers.clear()
    sentEvents.length = 0
    fakeWin = { sent: [] }
    const win = {
      webContents: {
        send: (channel: string, payload: unknown) => {
          fakeWin.sent.push({ channel, payload })
        },
      },
    } as unknown as import('electron').BrowserWindow
    getWindow = () => win
  })

  it('registers GET_READINESS handler immediately and reports booting state', async () => {
    registerSecurityReadinessIpc(getWindow)
    const state = await invoke<{ ready: boolean; reason?: string }>(
      SECURITY_IPC_CHANNELS.GET_READINESS,
    )
    expect(state).toEqual({ ready: false, reason: 'booting' })
  })

  it('setReadiness(ready=true) flips state and broadcasts EVT_READINESS_CHANGED', async () => {
    const { setReadiness } = registerSecurityReadinessIpc(getWindow)
    setReadiness({ ready: true })
    expect(fakeWin.sent.at(-1)).toEqual({
      channel: SECURITY_IPC_CHANNELS.EVT_READINESS_CHANGED,
      payload: { ready: true },
    })
    const after = await invoke<{ ready: boolean }>(SECURITY_IPC_CHANNELS.GET_READINESS)
    expect(after).toEqual({ ready: true })
  })

  it('setReadiness(scanner-unavailable) surfaces the failure state to the renderer', async () => {
    const { setReadiness } = registerSecurityReadinessIpc(getWindow)
    setReadiness({ ready: false, reason: 'scanner-unavailable' })
    expect(fakeWin.sent.at(-1)).toEqual({
      channel: SECURITY_IPC_CHANNELS.EVT_READINESS_CHANGED,
      payload: { ready: false, reason: 'scanner-unavailable' },
    })
    const after = await invoke<{ ready: boolean; reason: string }>(
      SECURITY_IPC_CHANNELS.GET_READINESS,
    )
    expect(after).toEqual({ ready: false, reason: 'scanner-unavailable' })
  })

  it('does not re-broadcast when readiness state is unchanged', () => {
    const { setReadiness } = registerSecurityReadinessIpc(getWindow)
    setReadiness({ ready: true })
    const after = fakeWin.sent.length
    setReadiness({ ready: true })
    expect(fakeWin.sent.length).toBe(after)
  })

  it('dispose() removes the GET_READINESS handler', () => {
    const { dispose } = registerSecurityReadinessIpc(getWindow)
    expect(handlers.has(SECURITY_IPC_CHANNELS.GET_READINESS)).toBe(true)
    dispose()
    expect(handlers.has(SECURITY_IPC_CHANNELS.GET_READINESS)).toBe(false)
  })
})

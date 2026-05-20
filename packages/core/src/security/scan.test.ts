import { describe, it, expect, beforeEach } from 'vitest'
import { Effect, Ref } from 'effect'
import Database from 'better-sqlite3'
import type { RedactProvider, SensitiveMatch } from '@spool-lab/redact'
import { regexProvider, hashValueForRedactExclude } from '@spool-lab/redact'
import { runMigrations } from '../db/db.js'
import { scanSession, ScanError } from './scan.js'
import { addAllowlistSession, listFindings } from './repo.js'
import type { FindingsChange } from './types.js'

function setupDb(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at)
     VALUES (1, 1, 1, 's-1', '/p/s-1', 'Session 1', '2026-01-01', '2026-01-01')`,
  ).run()
  return db
}

function makeChangeCollector() {
  const events: FindingsChange[] = []
  const publish = (c: FindingsChange) => Effect.sync(() => { events.push(c) })
  return { events, publish }
}

describe('scanSession', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('produces a finding from regex provider for a seeded fake AWS key', async () => {
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'Found AKIAIOSFODNN7EXAMPLE in the log', '2026-01-01', 0)`,
    ).run()
    const { events, publish } = makeChangeCollector()
    const result = await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish,
      }),
    )
    expect(result.inserted).toBeGreaterThan(0)
    const rows = listFindings(db, { sessionId: 1 })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.find(r => r.kind === 'api-key')).toBeDefined()
    expect(events).toEqual([{ type: 'session-rescanned', sessionId: 1 }])
    // scan_profile + counters set
    const sess = db.prepare('SELECT scan_profile, scan_finding_count FROM sessions WHERE id = 1').get() as { scan_profile: string; scan_finding_count: number }
    expect(sess.scan_profile).toBe('regex@3')
    expect(sess.scan_finding_count).toBe(rows.length)
  })

  it('handles empty sessions by marking them scanned with zero findings', async () => {
    const { publish } = makeChangeCollector()
    const result = await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish,
      }),
    )
    expect(result.inserted).toBe(0)
    const sess = db.prepare('SELECT scan_profile FROM sessions WHERE id = 1').get() as { scan_profile: string }
    expect(sess.scan_profile).toBe('regex@3')
  })

  it('is idempotent: rescanning produces the same finding rows (counts unchanged)', async () => {
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'Found AKIAIOSFODNN7EXAMPLE in the log', '2026-01-01', 0)`,
    ).run()
    const deps = {
      db,
      providers: [regexProvider],
      currentProfile: 'regex@3',
      providerNames: ['regex'],
      publish: () => Effect.void,
    }
    const first = await Effect.runPromise(scanSession(1, deps))
    const second = await Effect.runPromise(scanSession(1, deps))
    expect(second.inserted).toBe(first.inserted)
    const counts = db.prepare('SELECT scan_finding_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number }
    expect(counts.scan_finding_count).toBe(first.inserted)
  })

  it('honors allowlist_session: matching value_hash → state=dismissed at insert', async () => {
    const akia = 'AKIAIOSFODNN7EXAMPLE'
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', ?, '2026-01-01', 0)`,
    ).run(`Found ${akia} in the log`)
    addAllowlistSession(db, 1, 'api-key', hashValueForRedactExclude(akia))
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish: () => Effect.void,
      }),
    )
    const allRows = listFindings(db, { sessionId: 1, state: 'any' })
    const apiKey = allRows.find(r => r.kind === 'api-key')!
    expect(apiKey.state).toBe('dismissed')
    // dismissed doesnt count toward scan_finding_count
    const counts = db.prepare('SELECT scan_finding_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number }
    expect(counts.scan_finding_count).toBe(allRows.length - 1)
  })

  it('higher-confidence provider wins on overlapping match', async () => {
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'Found AKIAIOSFODNN7EXAMPLE token', '2026-01-01', 0)`,
    ).run()
    // A fake provider that re-detects the same AWS key at slightly lower confidence.
    const fakeLowConf: RedactProvider = {
      name: 'fake',
      displayName: 'fake',
      available: () => true,
      analyze: async (text: string) => {
        const i = text.indexOf('AKIA')
        if (i < 0) return []
        const m: SensitiveMatch = {
          kind: 'api-key',
          value: text.slice(i, i + 20),
          start: i,
          end: i + 20,
          confidence: 0.5,
          provider: 'fake',
        }
        return [m]
      },
    }
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider, fakeLowConf],
        currentProfile: 'regex@3',
        providerNames: ['regex', 'fake'],
        publish: () => Effect.void,
      }),
    )
    const rows = listFindings(db, { sessionId: 1, kind: 'api-key' })
    // Only one row for the AWS key; provider attribution is the higher-conf one.
    expect(rows).toHaveLength(1)
    expect(rows[0]!.provider).toBe('regex')
  })

  it('emits ScanError when the provider throws', async () => {
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'anything', '2026-01-01', 0)`,
    ).run()
    const crashy: RedactProvider = {
      name: 'crashy',
      displayName: 'crashy',
      available: () => true,
      analyze: async () => { throw new Error('boom') },
    }
    const exit = await Effect.runPromiseExit(
      scanSession(1, {
        db,
        providers: [crashy],
        currentProfile: 'crashy@1',
        providerNames: ['crashy'],
        publish: () => Effect.void,
      }),
    )
    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = (exit.cause as { _tag?: string }).toString()
      expect(err).toMatch(/ScanError/)
    }
  })

  it('preserves prior provider findings when re-scanning with a subset of providers', async () => {
    // First scan with regex + fake; both insert findings.
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'Found AKIAIOSFODNN7EXAMPLE and zzz', '2026-01-01', 0)`,
    ).run()
    const fakeProvider: RedactProvider = {
      name: 'fake',
      displayName: 'fake',
      available: () => true,
      analyze: async (text: string) => {
        if (!text.includes('zzz')) return []
        return [{
          kind: 'generic-secret',
          value: 'zzz',
          start: text.indexOf('zzz'),
          end: text.indexOf('zzz') + 3,
          confidence: 0.6,
          provider: 'fake',
        }]
      },
    }
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider, fakeProvider],
        currentProfile: 'regex@3,fake@1',
        providerNames: ['regex', 'fake'],
        publish: () => Effect.void,
      }),
    )
    const before = listFindings(db, { sessionId: 1, state: 'any' })
    expect(before.find(r => r.provider === 'fake')).toBeDefined()

    // Second scan WITHOUT fake — providerNames excludes 'fake', so its
    // historical row should survive.
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish: () => Effect.void,
      }),
    )
    const after = listFindings(db, { sessionId: 1, state: 'any' })
    expect(after.find(r => r.provider === 'fake')).toBeDefined()
  })

  // Regression for the muted-kinds bug discovered against the live
  // dev DB: a mute → unmute cycle used to accumulate phantom
  // dismissed rows because `deleteActiveFindings` only deleted
  // state='active'. Now `deleteRefreshableFindings` wipes both
  // active + dismissed for the providers being rescanned so the
  // re-insert is canonical.
  it('mute → unmute leaves no phantom dismissed rows (regression)', async () => {
    // Seed two messages each containing an email match.
    db.prepare(
      `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
       VALUES (10, 1, 1, 'user', 'first leak: alice@example.com here', '2026-01-01', 0),
              (11, 1, 1, 'user', 'second leak: bob@example.com there', '2026-01-01', 1)`,
    ).run()

    // First scan with no allowlist — both emails should be active.
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish: () => Effect.void,
      }),
    )
    const baseline = listFindings(db, { sessionId: 1, state: 'any' })
      .filter(r => r.kind === 'email')
    expect(baseline.length).toBe(2)
    expect(baseline.every(r => r.state === 'active')).toBe(true)

    // Mute email → rescan with kindAllowlist=['email']. Findings flip
    // to dismissed; the dismissed *count* must equal the unique
    // match count, not double it.
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: "regex@3,allow@deadbeef",
        providerNames: ['regex'],
        publish: () => Effect.void,
        kindAllowlist: new Set(['email']),
      }),
    )
    const muted = listFindings(db, { sessionId: 1, state: 'any' })
      .filter(r => r.kind === 'email')
    expect(muted.length).toBe(2)
    expect(muted.every(r => r.state === 'dismissed')).toBe(true)

    // Unmute email → rescan with empty allowlist. Findings flip back
    // to active; total count stays at 2 (no phantom dismissed
    // accumulation from the previous cycle).
    await Effect.runPromise(
      scanSession(1, {
        db,
        providers: [regexProvider],
        currentProfile: 'regex@3',
        providerNames: ['regex'],
        publish: () => Effect.void,
      }),
    )
    const restored = listFindings(db, { sessionId: 1, state: 'any' })
      .filter(r => r.kind === 'email')
    expect(restored.length).toBe(2)
    expect(restored.every(r => r.state === 'active')).toBe(true)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { Effect } from 'effect'
import Database from 'better-sqlite3'
import { runMigrations } from '../db/db.js'
import { insertFindings, listFindings, updateSessionCounts } from './repo.js'
import { purgeFinding, purgeFindings, purgeEverywhere, orderForBulkPurge, PurgeError } from './purge.js'
import { occurrencesByValueHash } from './repo.js'

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

function insertMessage(db: Database.Database, id: number, content: string): void {
  db.prepare(
    `INSERT INTO messages (id, session_id, source_id, role, content_text, timestamp, seq)
     VALUES (?, 1, 1, 'user', ?, '2026-01-01', 0)`,
  ).run(id, content)
}

const deps = (db: Database.Database) => ({
  db,
  publish: () => Effect.void,
})

describe('purgeFinding', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('rewrites messages.content_text with the per-kind mask and flips state', async () => {
    const raw = 'AKIAIOSFODNN7EXAMPLE'
    const content = `Found ${raw} in logs`
    insertMessage(db, 10, content)
    const start = content.indexOf(raw)
    insertFindings(db, [{
      sessionId: 1, messageId: 10, kind: 'api-key', valueHash: 'h1', confidence: 0.95,
      provider: 'regex', startOffset: start, endOffset: start + raw.length, state: 'active',
    }])
    updateSessionCounts(db, 1)
    const f = listFindings(db, { sessionId: 1 })[0]!

    const result = await Effect.runPromise(purgeFinding(f.id, deps(db)))
    expect(result.findingId).toBe(f.id)
    expect(result.maskUsed).toBe('[redacted: AWS key]')

    const msg = db.prepare('SELECT content_text FROM messages WHERE id = 10').get() as { content_text: string }
    expect(msg.content_text).toBe('Found [redacted: AWS key] in logs')
    expect(msg.content_text.includes(raw)).toBe(false)

    const after = listFindings(db, { sessionId: 1, state: 'any' })
    expect(after[0]!.state).toBe('purged')

    // counts: 'purged' shouldn't be counted in scan_finding_count
    const counts = db.prepare('SELECT scan_finding_count, scan_high_count FROM sessions WHERE id = 1').get() as { scan_finding_count: number; scan_high_count: number }
    expect(counts.scan_finding_count).toBe(0)
    expect(counts.scan_high_count).toBe(0)
  })

  it('removes the raw value from messages_fts so search no longer matches', async () => {
    const raw = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
    const content = `My token is ${raw} please rotate`
    insertMessage(db, 11, content)
    const start = content.indexOf(raw)
    insertFindings(db, [{
      sessionId: 1, messageId: 11, kind: 'api-key', valueHash: 'h2', confidence: 0.98,
      provider: 'regex', startOffset: start, endOffset: start + raw.length, state: 'active',
    }])
    const f = listFindings(db, { sessionId: 1 })[0]!

    // FTS contains the raw value before purge
    const beforeHits = db.prepare(
      "SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?",
    ).get('"ghp_abcdefghijklmnopqrstuvwxyz0123456789"') as { n: number }
    expect(beforeHits.n).toBe(1)

    await Effect.runPromise(purgeFinding(f.id, deps(db)))

    const afterHits = db.prepare(
      "SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?",
    ).get('"ghp_abcdefghijklmnopqrstuvwxyz0123456789"') as { n: number }
    expect(afterHits.n).toBe(0)
  })

  it('refuses to re-purge an already purged finding', async () => {
    const raw = 'AKIAIOSFODNN7EXAMPLE'
    insertMessage(db, 12, `prefix ${raw} suffix`)
    insertFindings(db, [{
      sessionId: 1, messageId: 12, kind: 'api-key', valueHash: 'h3', confidence: 0.95,
      provider: 'regex', startOffset: 7, endOffset: 7 + raw.length, state: 'active',
    }])
    const f = listFindings(db, { sessionId: 1 })[0]!
    await Effect.runPromise(purgeFinding(f.id, deps(db)))
    const exit = await Effect.runPromiseExit(purgeFinding(f.id, deps(db)))
    expect(exit._tag).toBe('Failure')
    if (exit._tag === 'Failure') {
      const err = (exit.cause as { _tag?: string }).toString()
      expect(err).toMatch(/PurgeError|already-purged/)
    }
  })

  it('fails cleanly when the finding does not exist', async () => {
    const exit = await Effect.runPromiseExit(purgeFinding(999, deps(db)))
    expect(exit._tag).toBe('Failure')
  })
})

describe('purgeFindings bulk', () => {
  let db: Database.Database
  beforeEach(() => { db = setupDb() })

  it('purges multiple findings in one message in descending offset order so spans stay valid', async () => {
    // Two values in one message; if applied earlier-first the second
    // offset would shift past the substring boundary.
    const content = 'AKIAIOSFODNN7AAAAAAA and AKIAIOSFODNN7BBBBBBB'
    insertMessage(db, 13, content)
    insertFindings(db, [
      { sessionId: 1, messageId: 13, kind: 'api-key', valueHash: 'hA', confidence: 0.95,
        provider: 'regex', startOffset: 0, endOffset: 20, state: 'active' },
      { sessionId: 1, messageId: 13, kind: 'api-key', valueHash: 'hB', confidence: 0.95,
        provider: 'regex', startOffset: 25, endOffset: 45, state: 'active' },
    ])
    const rows = listFindings(db, { sessionId: 1 })
    // Order findingIds with descending offset (highest first).
    const orderedIds = [...rows].sort((a, b) => b.startOffset - a.startOffset).map(r => r.id)
    const results = await Effect.runPromise(purgeFindings(orderedIds, deps(db)))
    expect(results).toHaveLength(2)
    const msg = db.prepare('SELECT content_text FROM messages WHERE id = 13').get() as { content_text: string }
    expect(msg.content_text.includes('AAAAAAA')).toBe(false)
    expect(msg.content_text.includes('BBBBBBB')).toBe(false)
    expect(msg.content_text).toBe('[redacted: AWS key] and [redacted: AWS key]')
  })

  it('skips already-purged findings in bulk and continues with the rest', async () => {
    const raw = 'AKIAIOSFODNN7EXAMPLE'
    insertMessage(db, 14, `text ${raw}`)
    insertFindings(db, [{
      sessionId: 1, messageId: 14, kind: 'api-key', valueHash: 'h', confidence: 0.95,
      provider: 'regex', startOffset: 5, endOffset: 5 + raw.length, state: 'active',
    }])
    const f = listFindings(db, { sessionId: 1 })[0]!
    await Effect.runPromise(purgeFinding(f.id, deps(db)))
    // Second pass — should not throw; should return empty array.
    const results = await Effect.runPromise(purgeFindings([f.id], deps(db)))
    expect(results).toEqual([])
  })

  // Regression for the bug discovered during review: two findings in
  // the SAME message at different offsets would corrupt each other if
  // applied in ascending order. The first purge shifts the string by
  // `mask.length - (end-start)`; the second slice then operates on
  // stale offsets, leaking part of the second secret or losing it.
  // The fix re-sorts to descending start_offset per message.
  it('preserves both secrets when two findings sit in the same message', async () => {
    const a = 'AKIAIOSFODNN7AAAAAAA'
    const b = 'AKIAIOSFODNN7BBBBBBB'
    const content = `first ${a} middle ${b} tail`
    insertMessage(db, 20, content)
    insertFindings(db, [
      {
        sessionId: 1, messageId: 20, kind: 'api-key', valueHash: 'ha', confidence: 0.95,
        provider: 'regex',
        startOffset: content.indexOf(a),
        endOffset: content.indexOf(a) + a.length,
        state: 'active',
      },
      {
        sessionId: 1, messageId: 20, kind: 'api-key', valueHash: 'hb', confidence: 0.95,
        provider: 'regex',
        startOffset: content.indexOf(b),
        endOffset: content.indexOf(b) + b.length,
        state: 'active',
      },
    ])
    updateSessionCounts(db, 1)
    // Caller passes lower-offset first — the typical UI ordering.
    // Without the fix, purgeFindings applies them in caller order and
    // the second slice cuts the wrong bytes.
    const findings = listFindings(db, { sessionId: 1 })
    const ascendingIds = findings
      .slice()
      .sort((x, y) => x.startOffset - y.startOffset)
      .map(r => r.id)

    const results = await Effect.runPromise(purgeFindings(ascendingIds, deps(db)))
    expect(results).toHaveLength(2)

    const after = db.prepare('SELECT content_text FROM messages WHERE id = 20')
      .get() as { content_text: string }
    // Neither raw value should survive anywhere in the message.
    expect(after.content_text.includes(a)).toBe(false)
    expect(after.content_text.includes(b)).toBe(false)
    // The surrounding tokens must remain intact — proves offsets
    // landed correctly, not shifted into adjacent text.
    expect(after.content_text.startsWith('first ')).toBe(true)
    expect(after.content_text.includes(' middle ')).toBe(true)
    expect(after.content_text.endsWith(' tail')).toBe(true)
  })

  describe('orderForBulkPurge', () => {
    it('returns ids grouped by message, descending start_offset within a message', () => {
      insertMessage(db, 30, 'msg A')
      insertMessage(db, 31, 'msg B')
      insertFindings(db, [
        { sessionId: 1, messageId: 30, kind: 'api-key', valueHash: 'h1', confidence: 0.9, provider: 'regex', startOffset: 10, endOffset: 20, state: 'active' },
        { sessionId: 1, messageId: 30, kind: 'api-key', valueHash: 'h2', confidence: 0.9, provider: 'regex', startOffset: 50, endOffset: 60, state: 'active' },
        { sessionId: 1, messageId: 31, kind: 'api-key', valueHash: 'h3', confidence: 0.9, provider: 'regex', startOffset: 5, endOffset: 15, state: 'active' },
      ])
      const findings = listFindings(db, { sessionId: 1 })
      const byHash = new Map(findings.map(f => [f.valueHash, f.id]))
      const ascending = [byHash.get('h1')!, byHash.get('h2')!, byHash.get('h3')!]
      const ordered = orderForBulkPurge(db, ascending)
      // Same message: h2 (start 50) before h1 (start 10). Across
      // messages: message_id 30 before 31 (deterministic).
      expect(ordered).toEqual([byHash.get('h2'), byHash.get('h1'), byHash.get('h3')])
    })

    it('returns [] for empty input', () => {
      expect(orderForBulkPurge(db, [])).toEqual([])
    })
  })
})

describe('purgeEverywhere', () => {
  function setupMultiSession(): Database.Database {
    const db = new Database(':memory:')
    runMigrations(db)
    db.prepare(
      `INSERT INTO projects (id, source_id, slug, display_path, display_name)
       VALUES (1, 1, 'a', '/a', 'a'), (2, 1, 'b', '/b', 'b')`,
    ).run()
    db.prepare(
      `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
       VALUES (1, 1, 1, 's-1', '/a/s-1', 'S1', '2026-01-01', '2026-01-01', 1),
              (2, 1, 1, 's-2', '/a/s-2', 'S2', '2026-01-02', '2026-01-02', 1),
              (3, 2, 1, 's-3', '/b/s-3', 'S3', '2026-01-03', '2026-01-03', 1)`,
    ).run()
    return db
  }

  const RAW = 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789'
  const HASH = 'gh-shared'

  let db: Database.Database
  beforeEach(() => {
    db = setupMultiSession()
    // Same key in session 1 (×2 in one message), session 2 (×1), and
    // session 3 (×1, other project). Plus an unrelated key in session 1
    // that must survive.
    insertMessage(db, 10, `first ${RAW} then ${RAW} done`)
    insertMessage(db, 20, `only ${RAW} here`)
    insertMessage(db, 30, `${RAW} alone`)
    const idx10a = `first ${RAW} then ${RAW} done`.indexOf(RAW)
    const idx10b = `first ${RAW} then ${RAW} done`.lastIndexOf(RAW)
    insertFindings(db, [
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: idx10a, endOffset: idx10a + RAW.length, state: 'active' },
      { sessionId: 1, messageId: 10, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: idx10b, endOffset: idx10b + RAW.length, state: 'active' },
      { sessionId: 2, messageId: 20, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: `only ${RAW} here`.indexOf(RAW), endOffset: `only ${RAW} here`.indexOf(RAW) + RAW.length, state: 'active' },
      { sessionId: 3, messageId: 30, kind: 'api-key', valueHash: HASH, confidence: 0.95, provider: 'regex', startOffset: 0, endOffset: RAW.length, state: 'active' },
    ])
    updateSessionCounts(db, 1); updateSessionCounts(db, 2); updateSessionCounts(db, 3)
  })

  function findById(db: Database.Database) {
    return (sessionId: number) => listFindings(db, { sessionId, state: 'any' })
  }

  it('masks every occurrence of the value across all sessions', async () => {
    const out = await Effect.runPromise(purgeEverywhere('api-key', HASH, deps(db)))
    expect(out.results).toHaveLength(4) // 2 + 1 + 1
    for (const id of [10, 20, 30]) {
      const msg = db.prepare('SELECT content_text FROM messages WHERE id = ?').get(id) as { content_text: string }
      expect(msg.content_text.includes(RAW)).toBe(false)
      expect(msg.content_text.includes('[redacted: GitHub key]')).toBe(true)
    }
  })

  it('returns the distinct touched session ids', async () => {
    const out = await Effect.runPromise(purgeEverywhere('api-key', HASH, deps(db)))
    expect([...out.sessionIds].sort()).toEqual([1, 2, 3])
  })

  it('flips all matching findings to purged and zeroes the blast radius', async () => {
    expect(occurrencesByValueHash(db, 'api-key', HASH)).toHaveLength(3)
    await Effect.runPromise(purgeEverywhere('api-key', HASH, deps(db)))
    const all = findById(db)
    for (const sid of [1, 2, 3]) {
      expect(all(sid).every(f => f.state === 'purged')).toBe(true)
    }
    // No active occurrences remain anywhere → blast radius is empty.
    expect(occurrencesByValueHash(db, 'api-key', HASH)).toHaveLength(0)
  })

  it('keeps messages_fts in sync so search no longer surfaces the value', async () => {
    const before = db.prepare(
      'SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?',
    ).get(`"${RAW}"`) as { n: number }
    expect(before.n).toBe(3) // one per message containing the key
    await Effect.runPromise(purgeEverywhere('api-key', HASH, deps(db)))
    const after = db.prepare(
      'SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?',
    ).get(`"${RAW}"`) as { n: number }
    expect(after.n).toBe(0)
  })

  it('does not touch a different value sharing the same kind', async () => {
    const OTHER = 'ghp_' + 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'
    insertMessage(db, 40, `unrelated ${OTHER}`)
    db.prepare(
      `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
       VALUES (4, 1, 1, 's-4', '/a/s-4', 'S4', '2026-01-04', '2026-01-04', 1)`,
    ).run()
    db.prepare('UPDATE messages SET session_id = 4 WHERE id = 40').run()
    insertFindings(db, [
      { sessionId: 4, messageId: 40, kind: 'api-key', valueHash: 'gh-other', confidence: 0.95, provider: 'regex', startOffset: `unrelated `.length, endOffset: `unrelated `.length + OTHER.length, state: 'active' },
    ])
    await Effect.runPromise(purgeEverywhere('api-key', HASH, deps(db)))
    const msg = db.prepare('SELECT content_text FROM messages WHERE id = 40').get() as { content_text: string }
    expect(msg.content_text.includes(OTHER)).toBe(true) // untouched
  })

  it('is a no-op (empty results) when nothing matches', async () => {
    const out = await Effect.runPromise(purgeEverywhere('api-key', 'no-such-hash', deps(db)))
    expect(out.results).toEqual([])
    expect(out.sessionIds).toEqual([])
  })
})

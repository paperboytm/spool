// Migration v14 covers two things:
//  1. Dedupe pre-existing (session_id, msg_uuid) duplicates that the
//     pre-append-only sync used to silently re-insert from the source.
//  2. Add a partial UNIQUE INDEX so future syncs can use INSERT OR
//     IGNORE as the dedupe primitive.
//
// The audit that motivated this (issue #344 follow-up) found 118 such
// pairs in a real archive, all content-identical, ~5% of them carrying
// findings. The dedupe path therefore has to cascade-clean findings
// and re-derive the denormalised counts on the touched sessions.

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { runMigrations, LATEST_SCHEMA_VERSION } from './db.js'

function seedV13(): Database.Database {
  const db = new Database(':memory:')
  runMigrations(db)
  // Roll the user_version back so we can seed pre-v14 state (the
  // index doesn't exist yet, so duplicate inserts are accepted).
  db.pragma('user_version = 13')
  // Drop the v14 index if a future bump re-creates one with the
  // same name — keeps the seed self-contained.
  db.exec('DROP INDEX IF EXISTS idx_messages_session_uuid')
  db.prepare(
    `INSERT INTO projects (id, source_id, slug, display_path, display_name)
     VALUES (1, 1, 'p', '/p', 'p')`,
  ).run()
  db.prepare(
    `INSERT INTO sessions (id, project_id, source_id, session_uuid, file_path, title, started_at, ended_at, message_count)
     VALUES (1, 1, 1, 's-1', '/p/s-1', 'S1', '2026-01-01', '2026-01-01', 0)`,
  ).run()
  return db
}

function insertMsg(db: Database.Database, opts: {
  id: number; sessionId: number; uuid: string | null;
  role?: string; content?: string; seq: number; sidechain?: boolean;
}): void {
  db.prepare(
    `INSERT INTO messages (id, session_id, source_id, msg_uuid, role, content_text, timestamp, is_sidechain, seq)
     VALUES (?, ?, 1, ?, ?, ?, '2026-01-01', ?, ?)`,
  ).run(
    opts.id, opts.sessionId, opts.uuid, opts.role ?? 'assistant',
    opts.content ?? '', opts.sidechain ? 1 : 0, opts.seq,
  )
}

function bumpToV14(db: Database.Database): void {
  // Re-invoke the public migration runner; it will see user_version=13
  // and apply the v14 step we just authored.
  runMigrations(db)
}

describe('migration v14: dedupe + UNIQUE INDEX(session_id, msg_uuid)', () => {
  let db: Database.Database
  beforeEach(() => { db = seedV13() })

  it('collapses identical-content dupes to the lowest id and bumps user_version', () => {
    insertMsg(db, { id: 10, sessionId: 1, uuid: 'a', content: 'hello', seq: 0 })
    insertMsg(db, { id: 11, sessionId: 1, uuid: 'a', content: 'hello', seq: 1 })
    insertMsg(db, { id: 12, sessionId: 1, uuid: 'b', content: 'world', seq: 2 })

    bumpToV14(db)

    const rows = db.prepare('SELECT id, msg_uuid FROM messages ORDER BY id').all() as Array<{ id: number; msg_uuid: string }>
    expect(rows).toEqual([
      { id: 10, msg_uuid: 'a' },
      { id: 12, msg_uuid: 'b' },
    ])
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0]!.user_version).toBe(LATEST_SCHEMA_VERSION)
  })

  it('cascade-deletes findings on dropped duplicate rows', () => {
    insertMsg(db, { id: 20, sessionId: 1, uuid: 'k', content: 'leak', seq: 0 })
    insertMsg(db, { id: 21, sessionId: 1, uuid: 'k', content: 'leak', seq: 5 })
    // findings on BOTH copies — the redundant copy carries a redundant
    // detection from the pre-dedupe scanner pass. After migration only
    // the kept copy's finding should remain.
    db.prepare(
      `INSERT INTO findings (id, session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state)
       VALUES (100, 1, 20, 'api-key', 'h', 0.9, 'regex', 0, 4, 'active'),
              (101, 1, 21, 'api-key', 'h', 0.9, 'regex', 0, 4, 'active')`,
    ).run()

    bumpToV14(db)

    const findings = db.prepare('SELECT id, message_id FROM findings ORDER BY id').all() as Array<{ id: number; message_id: number }>
    expect(findings).toEqual([{ id: 100, message_id: 20 }])
  })

  it('recomputes session.message_count after dedupe (non-sidechain only)', () => {
    insertMsg(db, { id: 30, sessionId: 1, uuid: 'x', seq: 0 })
    insertMsg(db, { id: 31, sessionId: 1, uuid: 'x', seq: 1 }) // dupe → drops
    insertMsg(db, { id: 32, sessionId: 1, uuid: 'y', seq: 2 })
    insertMsg(db, { id: 33, sessionId: 1, uuid: 'z', seq: 3, sidechain: true })
    db.prepare('UPDATE sessions SET message_count = ? WHERE id = 1').run(3) // pre-dedupe inflated

    bumpToV14(db)

    const row = db.prepare('SELECT message_count FROM sessions WHERE id = 1').get() as { message_count: number }
    // 2 non-sidechain after dedupe (x kept once, y), z is sidechain.
    expect(row.message_count).toBe(2)
  })

  it('recomputes scan counts using the redact severity sets', () => {
    insertMsg(db, { id: 40, sessionId: 1, uuid: 'x', seq: 0 })
    insertMsg(db, { id: 41, sessionId: 1, uuid: 'x', seq: 1 }) // dupe → drops
    // Survivor-row findings: one HIGH (api-key), one LOW (email),
    // one INFO (absolute-path), one purged. After recompute:
    //   scan_finding_count = 2 (HIGH + LOW; INFO excluded)
    //   scan_high_count    = 1 (api-key)
    //   scan_purged_count  = 1
    db.prepare(
      `INSERT INTO findings (session_id, message_id, kind, value_hash, confidence, provider, start_offset, end_offset, state)
       VALUES (1, 40, 'api-key',       'h1', 0.9, 'regex', 0, 1, 'active'),
              (1, 40, 'email',         'h2', 0.9, 'regex', 1, 2, 'active'),
              (1, 40, 'absolute-path', 'h3', 0.9, 'regex', 2, 3, 'active'),
              (1, 40, 'api-key',       'h4', 0.9, 'regex', 3, 4, 'purged')`,
    ).run()
    // Pre-dedupe inflated counts.
    db.prepare(
      `UPDATE sessions SET scan_finding_count = 99, scan_high_count = 99, scan_purged_count = 99 WHERE id = 1`,
    ).run()

    bumpToV14(db)

    const row = db.prepare(
      'SELECT scan_finding_count, scan_high_count, scan_purged_count FROM sessions WHERE id = 1',
    ).get() as { scan_finding_count: number; scan_high_count: number; scan_purged_count: number }
    expect(row).toEqual({ scan_finding_count: 2, scan_high_count: 1, scan_purged_count: 1 })
  })

  it('adds a partial UNIQUE index that rejects future duplicates', () => {
    bumpToV14(db)
    insertMsg(db, { id: 50, sessionId: 1, uuid: 'p', seq: 0 })
    expect(() => insertMsg(db, { id: 51, sessionId: 1, uuid: 'p', seq: 1 }))
      .toThrow(/UNIQUE constraint/)
  })

  it('allows multiple NULL msg_uuid rows in the same session (partial index)', () => {
    bumpToV14(db)
    // No current parser emits NULL, but the schema doesn't forbid it
    // — the partial index must mirror that and stay out of NULL rows.
    insertMsg(db, { id: 60, sessionId: 1, uuid: null, seq: 0 })
    expect(() => insertMsg(db, { id: 61, sessionId: 1, uuid: null, seq: 1 }))
      .not.toThrow()
  })

  it('leaves messages_fts in sync after cascade DELETE', () => {
    insertMsg(db, { id: 70, sessionId: 1, uuid: 'q', content: 'searchable-token', seq: 0 })
    insertMsg(db, { id: 71, sessionId: 1, uuid: 'q', content: 'searchable-token', seq: 1 })

    bumpToV14(db)

    // FTS should hit exactly once (one surviving row), not twice.
    const hits = db.prepare(
      'SELECT COUNT(*) AS n FROM messages_fts WHERE messages_fts MATCH ?',
    ).get('"searchable-token"') as { n: number }
    expect(hits.n).toBe(1)
  })

  it('is idempotent — re-running migrations does not re-dedupe or re-throw', () => {
    insertMsg(db, { id: 80, sessionId: 1, uuid: 'r', seq: 0 })
    insertMsg(db, { id: 81, sessionId: 1, uuid: 'r', seq: 1 })
    bumpToV14(db)
    expect((db.pragma('user_version') as Array<{ user_version: number }>)[0]!.user_version).toBe(LATEST_SCHEMA_VERSION)

    // Second pass — no-op.
    runMigrations(db)
    const count = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE msg_uuid = ?').get('r') as { c: number }
    expect(count.c).toBe(1)
  })
})

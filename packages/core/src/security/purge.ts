// Purge mechanism — the only destructive action in the Security
// Scan feature.
//
// What it does: rewrites the raw secret in `messages.content_text`
// with the per-kind mask from @spool-lab/redact (e.g. `[redacted:
// AWS key]`), flips the finding to `state='purged'`, recomputes the
// session's denormalised counts, and lets the existing FTS triggers
// sync messages_fts automatically.
//
// What it does NOT do: touch the source transcript file in
// `~/.claude/sessions/`, the `.spool` exports the user may already
// have published, or OS backups of `spool.db`. Those are Phase 2/3
// vault concerns documented in the spec.
//
// Bulk-by-message ordering: when several findings sit in the same
// message, apply them in DESCENDING start_offset order so earlier
// offsets stay valid as the string shifts.

import { Data, Effect } from 'effect'
import type Database from 'better-sqlite3'
import type { SensitiveKind } from '@spool-lab/redact'
import { maskValueByKind } from '@spool-lab/redact'
import { updateSessionCounts } from './repo.js'
import type { FindingsChange, FindingState } from './types.js'

export class PurgeError extends Data.TaggedError('PurgeError')<{
  readonly findingId: number
  readonly reason: 'not-found' | 'already-purged' | 'message-missing' | 'db-failed'
  readonly cause?: unknown
}> {}

export interface PurgeResult {
  findingId: number
  sessionId: number
  /** The mask string that replaced the raw value. */
  maskUsed: string
  purgedAt: string
}

interface FindingForPurge {
  id: number
  session_id: number
  message_id: number | null
  kind: string
  start_offset: number
  end_offset: number
  state: FindingState
}

export interface PurgeDeps {
  db: Database.Database
  publish: (change: FindingsChange) => Effect.Effect<void>
}

/** Purge one finding. Idempotent on "already purged" → returns a
 *  PurgeError so the UI can surface a no-op. */
export function purgeFinding(
  findingId: number,
  deps: PurgeDeps,
): Effect.Effect<PurgeResult, PurgeError> {
  return Effect.gen(function* () {
    const row = yield* Effect.try({
      try: () =>
        deps.db.prepare(
          `SELECT id, session_id, message_id, kind, start_offset, end_offset, state
             FROM findings WHERE id = ?`,
        ).get(findingId) as FindingForPurge | undefined,
      catch: (cause) => new PurgeError({ findingId, reason: 'db-failed', cause }),
    })
    if (!row) {
      return yield* Effect.fail(new PurgeError({ findingId, reason: 'not-found' }))
    }
    if (row.state === 'purged') {
      return yield* Effect.fail(new PurgeError({ findingId, reason: 'already-purged' }))
    }
    if (row.message_id === null) {
      return yield* Effect.fail(new PurgeError({ findingId, reason: 'message-missing' }))
    }

    const messageId = row.message_id
    const kind = row.kind as SensitiveKind
    const result = yield* Effect.try({
      try: () => applyPurgeTxn(deps.db, row, messageId, kind),
      catch: (cause) => new PurgeError({ findingId, reason: 'db-failed', cause }),
    })

    yield* deps.publish({
      type: 'state-changed',
      sessionId: row.session_id,
      findingId: row.id,
      state: 'purged',
    })

    return result
  }).pipe(
    Effect.withSpan('security.purge.single', { attributes: { findingId } }),
  )
}

/** Bulk purge across many findings.
 *
 *  Ordering: caller passes an arbitrary order; we re-sort to the only
 *  correct order — group by `message_id`, then within each group
 *  apply in **descending** `start_offset` so earlier offsets stay
 *  valid as the string shifts. Without this two findings inside the
 *  same message at offsets [10..20] and [40..60] would corrupt:
 *  purging [10..20] first shifts everything after by `mask.length -
 *  10`, and the second slice now points at the wrong bytes.
 *
 *  Performance: the whole bulk runs in ONE sqlite transaction with
 *  one `content_text` SELECT/UPDATE per affected message and ONE
 *  `updateSessionCounts` per affected session. The earlier
 *  per-finding loop paid a fsync per finding (~3–5 ms on macOS) and
 *  rebuilt session counts N times; on archives with ~17 k absolute-
 *  path findings concentrated in a handful of sessions that
 *  serialised into ~60 s of main-process work and froze the app
 *  (issue #344). */
export function purgeFindings(
  findingIds: readonly number[],
  deps: PurgeDeps,
): Effect.Effect<PurgeResult[], PurgeError> {
  return Effect.gen(function* () {
    if (findingIds.length === 0) {
      return [] as PurgeResult[]
    }

    // Resolve every row up front so the transaction body never has
    // to fan back out into per-finding SELECTs. The Map keys also
    // dedupe accidental duplicate ids cheaply.
    const rows = yield* Effect.try({
      try: () => loadFindingsForBulkPurge(deps.db, findingIds),
      catch: (cause) => new PurgeError({ findingId: -1, reason: 'db-failed', cause }),
    })

    // Mirror single-purge pre-checks so callers passing a stale or
    // orphan id get the same `PurgeError` they'd see one at a time.
    // Done BEFORE opening the transaction so a bad id never leaves a
    // half-purged batch behind — the old loop committed each finding
    // separately and could abort partway through.
    for (const id of new Set(findingIds)) {
      const row = rows.get(id)
      if (!row) {
        return yield* Effect.fail(new PurgeError({ findingId: id, reason: 'not-found' }))
      }
      if (row.state === 'active' && row.message_id === null) {
        return yield* Effect.fail(new PurgeError({ findingId: id, reason: 'message-missing' }))
      }
    }

    const { results, sessionIds } = yield* Effect.try({
      try: () => applyBulkPurgeTxn(deps.db, rows),
      catch: (cause) => new PurgeError({ findingId: -1, reason: 'db-failed', cause }),
    })

    // One coalesced event per touched session — the renderer's
    // 300 ms debounce in SecurityPage / BlastRadius / SessionDetail
    // would have collapsed N per-finding events into a single refetch
    // anyway, so emitting one up front skips N-1 IPC hops.
    for (const sessionId of sessionIds) {
      yield* deps.publish({
        type: 'state-changed',
        sessionId,
        state: 'purged',
      })
    }

    yield* Effect.annotateCurrentSpan('purged', results.length)
    return results
  }).pipe(
    Effect.withSpan('security.purge.bulk', { attributes: { requested: findingIds.length } }),
  )
}

/** Purge EVERY active occurrence of one leaked value — the
 *  `(kind, value_hash)` pair — across all sessions in the archive, in a
 *  single logical operation. The natural follow-through to "I've rotated
 *  this key at the source → now scrub every copy from Spool's surfaces".
 *
 *  Delegates to {@link purgeFindings}, which re-orders the collected ids
 *  via {@link orderForBulkPurge} so per-message offsets stay valid. The
 *  original `~/.claude` session files are NOT touched — this masks only
 *  Spool's stored copies (DB + FTS), closing the search / AI / browse
 *  exposure.
 *
 *  Returns the purge results plus the distinct session ids touched, in
 *  first-seen order, so the IPC layer can emit one change event per
 *  session. */
export function purgeEverywhere(
  kind: SensitiveKind,
  valueHash: string,
  deps: PurgeDeps,
): Effect.Effect<{ results: PurgeResult[]; sessionIds: number[] }, PurgeError> {
  return Effect.gen(function* () {
    const ids = yield* Effect.try({
      try: () =>
        (deps.db.prepare(
          `SELECT id FROM findings
            WHERE kind = ? AND value_hash = ? AND state = 'active'`,
        ).all(kind, valueHash) as Array<{ id: number }>).map(r => r.id),
      catch: (cause) => new PurgeError({ findingId: -1, reason: 'db-failed', cause }),
    })
    const results = yield* purgeFindings(ids, deps)
    const seen = new Set<number>()
    const sessionIds: number[] = []
    for (const r of results) {
      if (!seen.has(r.sessionId)) { seen.add(r.sessionId); sessionIds.push(r.sessionId) }
    }
    return { results, sessionIds }
  }).pipe(
    Effect.withSpan('security.purge.everywhere', { attributes: { kind } }),
  )
}

/** Produce a purge order that's safe against offset drift. Findings
 *  with `message_id IS NULL` (orphan rows that the schema permits but
 *  should never happen in practice) fall to the end so they don't
 *  interfere with message-grouped batches.
 *
 *  Exported only for tests. */
export function orderForBulkPurge(
  db: Database.Database,
  findingIds: readonly number[],
): number[] {
  if (findingIds.length === 0) return []
  const placeholders = findingIds.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT id, message_id, start_offset
       FROM findings
      WHERE id IN (${placeholders})`,
  ).all(...findingIds) as Array<{ id: number; message_id: number | null; start_offset: number }>

  const byMessage = new Map<number | null, Array<{ id: number; start_offset: number }>>()
  for (const r of rows) {
    const key = r.message_id
    let bucket = byMessage.get(key)
    if (!bucket) { bucket = []; byMessage.set(key, bucket) }
    bucket.push({ id: r.id, start_offset: r.start_offset })
  }
  for (const bucket of byMessage.values()) {
    bucket.sort((a, b) => b.start_offset - a.start_offset)
  }
  // Stable iteration order over the messages doesn't matter for
  // correctness — purges in different messages can't shift each
  // other's offsets. We sort by message_id (nulls last) for
  // determinism in tests.
  const messageKeys = [...byMessage.keys()].sort((a, b) => {
    if (a === null) return 1
    if (b === null) return -1
    return a - b
  })

  const out: number[] = []
  for (const key of messageKeys) {
    for (const r of byMessage.get(key)!) out.push(r.id)
  }
  return out
}

function loadFindingsForBulkPurge(
  db: Database.Database,
  findingIds: readonly number[],
): Map<number, FindingForPurge> {
  const out = new Map<number, FindingForPurge>()
  if (findingIds.length === 0) return out
  // Chunk the IN-list — sqlite caps host parameters at 999 by
  // default and a single rescan can hand us tens of thousands of ids.
  const CHUNK = 500
  for (let i = 0; i < findingIds.length; i += CHUNK) {
    const slice = findingIds.slice(i, i + CHUNK)
    const placeholders = slice.map(() => '?').join(',')
    const rows = db.prepare(
      `SELECT id, session_id, message_id, kind, start_offset, end_offset, state
         FROM findings WHERE id IN (${placeholders})`,
    ).all(...slice) as FindingForPurge[]
    for (const r of rows) out.set(r.id, r)
  }
  return out
}

function applyBulkPurgeTxn(
  db: Database.Database,
  rows: Map<number, FindingForPurge>,
): { results: PurgeResult[]; sessionIds: number[] } {
  // Only `active` rows do work; `purged` rows are silently skipped to
  // preserve the prior idempotent-on-replay semantics ("re-clicking
  // Purge after a partial failure must not error"). Orphan rows have
  // already been screened by the caller's pre-checks.
  const active: FindingForPurge[] = []
  for (const row of rows.values()) {
    if (row.state === 'active' && row.message_id !== null) active.push(row)
  }

  // Group by message so each message body is rewritten exactly once.
  const byMessage = new Map<number, FindingForPurge[]>()
  for (const row of active) {
    const key = row.message_id as number
    let bucket = byMessage.get(key)
    if (!bucket) { bucket = []; byMessage.set(key, bucket) }
    bucket.push(row)
  }
  // Descending offset within each message — earlier offsets stay
  // valid as the suffix shifts.
  for (const bucket of byMessage.values()) {
    bucket.sort((a, b) => b.start_offset - a.start_offset)
  }

  const purgedAt = new Date().toISOString()
  const results: PurgeResult[] = []
  const sessionIdsSeen = new Set<number>()
  const sessionIds: number[] = []
  const sessionsToRecount = new Set<number>()

  const selectMessage = db.prepare(
    'SELECT content_text FROM messages WHERE id = ?',
  )
  const updateMessage = db.prepare(
    'UPDATE messages SET content_text = ? WHERE id = ?',
  )
  const updateFinding = db.prepare(
    `UPDATE findings
        SET state = 'purged', state_changed_at = ?
      WHERE id = ?`,
  )

  // One transaction wraps the whole batch: a single fsync at COMMIT
  // instead of one per finding. This is the load-bearing change for
  // issue #344 — 17 k findings went from ~60 s to a few hundred ms.
  db.transaction(() => {
    for (const [messageId, bucket] of byMessage) {
      const msg = selectMessage.get(messageId) as { content_text: string } | undefined
      if (!msg) {
        // The session-rescan / cascade-delete window is narrow but
        // possible; treat a missing message like the single-purge
        // path's "disappeared between read and purge" — throw inside
        // the transaction so sqlite rolls everything back.
        throw new Error(`Message ${messageId} disappeared between read and purge`)
      }

      let text = msg.content_text
      for (const finding of bucket) {
        const original = text.slice(finding.start_offset, finding.end_offset)
        const mask = maskValueByKind(original, finding.kind as SensitiveKind)
        text =
          text.slice(0, finding.start_offset) +
          mask +
          text.slice(finding.end_offset)
        updateFinding.run(purgedAt, finding.id)
        results.push({
          findingId: finding.id,
          sessionId: finding.session_id,
          maskUsed: mask,
          purgedAt,
        })
        if (!sessionIdsSeen.has(finding.session_id)) {
          sessionIdsSeen.add(finding.session_id)
          sessionIds.push(finding.session_id)
        }
        sessionsToRecount.add(finding.session_id)
      }
      updateMessage.run(text, messageId)
    }

    // Recompute denormalised counts once per affected session — the
    // earlier per-finding loop called this N times for sessions that
    // had a large fan-in, which on its own ran two SELECTs +
    // an UPDATE per call.
    for (const sessionId of sessionsToRecount) {
      updateSessionCounts(db, sessionId)
    }
  })()

  return { results, sessionIds }
}

function applyPurgeTxn(
  db: Database.Database,
  finding: FindingForPurge,
  messageId: number,
  kind: SensitiveKind,
): PurgeResult {
  const msg = db.prepare(
    'SELECT content_text FROM messages WHERE id = ?',
  ).get(messageId) as { content_text: string } | undefined
  if (!msg) {
    throw new Error(`Message ${messageId} disappeared between read and purge`)
  }

  const original = msg.content_text.slice(finding.start_offset, finding.end_offset)
  const mask = maskValueByKind(original, kind)
  const purgedAt = new Date().toISOString()

  db.transaction(() => {
    const newText =
      msg.content_text.slice(0, finding.start_offset) +
      mask +
      msg.content_text.slice(finding.end_offset)
    db.prepare('UPDATE messages SET content_text = ? WHERE id = ?')
      .run(newText, messageId)
    db.prepare(
      `UPDATE findings
          SET state = 'purged',
              state_changed_at = ?
        WHERE id = ?`,
    ).run(purgedAt, finding.id)
    updateSessionCounts(db, finding.session_id)
  })()

  return {
    findingId: finding.id,
    sessionId: finding.session_id,
    maskUsed: mask,
    purgedAt,
  }
}

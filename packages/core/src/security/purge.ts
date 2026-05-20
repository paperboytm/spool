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
  })
}

/** Bulk purge across many findings. Caller passes an arbitrary
 *  ordering; we re-sort to the only correct order:
 *
 *    1. Group by `message_id`
 *    2. Within each group, apply in **descending** `start_offset` so
 *       earlier offsets stay valid as the string shifts.
 *
 *  Without this re-sort, two findings inside the same message at
 *  offsets [10..20] and [40..60] would corrupt: purging [10..20]
 *  first shifts everything after offset 20 by `mask.length - 10`,
 *  and the second slice [40..60] now points at the wrong bytes
 *  (often leaking part of the second secret into the mask, or
 *  losing it entirely). */
export function purgeFindings(
  findingIds: readonly number[],
  deps: PurgeDeps,
): Effect.Effect<PurgeResult[], PurgeError> {
  return Effect.gen(function* () {
    // Resolve offsets/message ids up front so we can deterministically
    // order. The Effect.try preserves db-failure → PurgeError mapping.
    const ordered = yield* Effect.try({
      try: () => orderForBulkPurge(deps.db, findingIds),
      catch: (cause) => new PurgeError({ findingId: -1, reason: 'db-failed', cause }),
    })

    const out: PurgeResult[] = []
    for (const id of ordered) {
      const result = yield* purgeFinding(id, deps).pipe(
        Effect.catchTag('PurgeError', (err) =>
          err.reason === 'already-purged'
            ? Effect.succeed(null)
            : Effect.fail(err),
        ),
      )
      if (result) out.push(result)
    }
    return out
  })
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

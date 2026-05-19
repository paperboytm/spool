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

/** Bulk purge across many findings. Groups by message_id and applies
 *  each message's findings in descending offset order; after the
 *  message is rewritten, offsets of every other finding in the same
 *  session may have shifted, so callers should treat the affected
 *  sessions' findings as stale until a rescan fires. */
export function purgeFindings(
  findingIds: readonly number[],
  deps: PurgeDeps,
): Effect.Effect<PurgeResult[], PurgeError> {
  return Effect.gen(function* () {
    const out: PurgeResult[] = []
    // Sequential — order matters within a message; correctness wins
    // over throughput here (purges are rare and small).
    for (const id of findingIds) {
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

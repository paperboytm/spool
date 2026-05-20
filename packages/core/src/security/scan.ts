// Per-session scan pipeline.
//
// Effect-shaped so the worker can compose it with Queue / Stream /
// supervisor primitives. The detection itself runs against
// `messages.content_text` only — Purge later mutates that field,
// findings re-detect, and the audit trail stays consistent.
//
// Transaction shape: detection runs *outside* the transaction (it
// can take seconds with ML); only the final apply step is atomic.
// If the worker dies mid-detection, scan_profile was never updated
// → restart re-enqueues from scratch. If it dies inside the
// transaction, SQLite atomicity guarantees no half-applied state.

import { Data, Effect } from 'effect'
import type Database from 'better-sqlite3'
import type { SensitiveMatch, RedactProvider } from '@spool-lab/redact'
import { hashValueForRedactExclude } from '@spool-lab/redact'
import {
  deleteRefreshableFindings,
  insertFindings,
  setSessionScanProfile,
  updateSessionCounts,
  getAllowlists,
  isAllowlisted,
  type FindingInput,
} from './repo.js'
import type { FindingsChange } from './types.js'

export class ScanError extends Data.TaggedError('ScanError')<{
  readonly sessionId: number
  readonly cause: unknown
  readonly reason: 'session-not-found' | 'provider-failed' | 'db-failed'
}> {}

interface MessageRow {
  id: number
  content_text: string
}

/** Result of one session scan — useful for tests and progress UIs. */
export interface ScanResult {
  sessionId: number
  inserted: number
  /** Profile string written to sessions.scan_profile. */
  profile: string
}

export interface ScanSessionDeps {
  /** SQLite database handle (same instance the Syncer uses). */
  db: Database.Database
  /** Active providers, evaluated in priority order. First entry wins
   *  on overlap (regex before pf — pattern matches are authoritative
   *  for known credential prefixes). */
  providers: readonly RedactProvider[]
  /** Profile string for the active provider set; persisted on
   *  successful scan. */
  currentProfile: string
  /** Names of providers whose prior `active` findings should be
   *  deleted before re-insert. Almost always equals the names in
   *  `providers`; passed explicitly so the worker can choose to
   *  preserve historical pf findings even when pf is disabled. */
  providerNames: readonly string[]
  /** Sink for change notifications. The worker layer wraps PubSub
   *  here; tests pass a simple collector. */
  publish: (change: FindingsChange) => Effect.Effect<void>
  /** Kind-level allowlist. Findings whose kind is in this set get
   *  inserted with state='dismissed' (instead of 'active') without
   *  needing a per-value allowlist row. Driven by the Settings →
   *  Security pane's multi-select. */
  kindAllowlist?: ReadonlySet<string>
}

/** Scan one session end to end. Idempotent: running twice produces
 *  the same findings (same value_hash + same offsets → same rows
 *  after the delete-then-insert reset). */
export function scanSession(
  sessionId: number,
  deps: ScanSessionDeps,
): Effect.Effect<ScanResult, ScanError> {
  return Effect.gen(function* () {
    // 1. Load messages outside the transaction.
    const messages = yield* Effect.try({
      try: () =>
        deps.db.prepare(
          `SELECT id, content_text
             FROM messages
            WHERE session_id = ?
            ORDER BY seq ASC`,
        ).all(sessionId) as MessageRow[],
      catch: (cause) => new ScanError({ sessionId, cause, reason: 'db-failed' }),
    })

    if (messages.length === 0) {
      // Session has no messages yet. Still mark it scanned with the
      // current profile so we don't loop on it; future sync will
      // invalidate the profile and re-enqueue.
      yield* applyEmpty(sessionId, deps)
      yield* deps.publish({ type: 'session-rescanned', sessionId })
      return { sessionId, inserted: 0, profile: deps.currentProfile }
    }

    // 2. Run providers per message. The flat list is enough — we
    // dedupe later by (kind, value_hash, start_offset) so producers
    // can be naive about overlap.
    const allMatches: Array<SensitiveMatch & { messageId: number }> = []
    for (const msg of messages) {
      for (const provider of deps.providers) {
        if (!provider.available()) continue
        const matches = yield* Effect.tryPromise<SensitiveMatch[], ScanError>({
          try: () => provider.analyze(msg.content_text),
          catch: (cause) => new ScanError({ sessionId, cause, reason: 'provider-failed' }),
        })
        for (const m of matches) {
          allMatches.push({ ...m, messageId: msg.id })
        }
      }
    }

    // 3. Dedupe across providers — pick the highest-confidence match
    // for each (kind, value_hash, start_offset).
    const merged = mergeMatches(allMatches)

    // 4. Allowlist join → assign initial state.
    const allow = yield* Effect.try({
      try: () => getAllowlists(deps.db, sessionId),
      catch: (cause) => new ScanError({ sessionId, cause, reason: 'db-failed' }),
    })

    const inputs: FindingInput[] = merged.map((m) => ({
      sessionId,
      messageId: m.messageId,
      kind: m.kind,
      valueHash: m.valueHash,
      confidence: m.confidence,
      provider: m.provider,
      startOffset: m.start,
      endOffset: m.end,
      state: (deps.kindAllowlist?.has(m.kind) || isAllowlisted(allow, m.kind, m.valueHash))
        ? 'dismissed'
        : 'active',
    }))

    // 5. Apply atomically.
    yield* Effect.try({
      try: () => {
        deps.db.transaction(() => {
          deleteRefreshableFindings(deps.db, sessionId, deps.providerNames)
          insertFindings(deps.db, inputs)
          setSessionScanProfile(deps.db, sessionId, deps.currentProfile, new Date().toISOString())
          updateSessionCounts(deps.db, sessionId)
        })()
      },
      catch: (cause) => new ScanError({ sessionId, cause, reason: 'db-failed' }),
    })

    yield* deps.publish({ type: 'session-rescanned', sessionId })

    return { sessionId, inserted: inputs.length, profile: deps.currentProfile }
  })
}

function applyEmpty(sessionId: number, deps: ScanSessionDeps): Effect.Effect<void, ScanError> {
  return Effect.try({
    try: () => {
      deps.db.transaction(() => {
        deleteRefreshableFindings(deps.db, sessionId, deps.providerNames)
        setSessionScanProfile(deps.db, sessionId, deps.currentProfile, new Date().toISOString())
        updateSessionCounts(deps.db, sessionId)
      })()
    },
    catch: (cause) => new ScanError({ sessionId, cause, reason: 'db-failed' }),
  })
}

type MergedMatch = SensitiveMatch & { messageId: number; valueHash: string }

/** Pick the highest-confidence match per (messageId, kind, value_hash,
 *  start). The same vendor token detected by two providers should
 *  produce one finding, attributed to whoever was most confident. */
function mergeMatches(
  matches: ReadonlyArray<SensitiveMatch & { messageId: number }>,
): MergedMatch[] {
  const byKey = new Map<string, MergedMatch>()
  for (const m of matches) {
    const hash = hashValueForRedactExclude(m.value)
    const key = `${m.messageId}|${m.kind}|${hash}|${m.start}`
    const existing = byKey.get(key)
    if (!existing || m.confidence > existing.confidence) {
      byKey.set(key, { ...m, valueHash: hash })
    }
  }
  return Array.from(byKey.values())
}

// Shared types for the Security Scan subsystem.
//
// These are the cross-boundary payloads — worker → IPC → renderer.
// They live in one module so:
//   1. The worker (main process), IPC adapters, and renderer hooks
//      can import a single source of truth.
//   2. Promoting them to `Schema.Struct` later (for a Scope-B Effect
//      RPC migration) is a local refactor, not a consumer rewrite.

import type { SensitiveKind, Severity } from '@spool-lab/redact'

/** A finding's lifecycle state.
 *
 *   active     — surfaced in Security page and session strip
 *   dismissed  — user opted to ignore; suppressed from default views
 *   purged     — raw value rewritten with a mask in
 *                messages.content_text; row remains as an audit record
 */
export type FindingState = 'active' | 'dismissed' | 'purged'

/** One row of the `findings` table, mapped to camelCase for the
 *  renderer. The raw sensitive value is NEVER part of this payload —
 *  consumers that need to render the original text fetch it via
 *  `getFindingValue(findingId)`, which reads
 *  `messages.content_text[startOffset..endOffset]` at request time. */
export interface FindingRow {
  id: number
  sessionId: number
  messageId: number | null
  kind: SensitiveKind
  valueHash: string
  confidence: number
  provider: string
  startOffset: number
  endOffset: number
  state: FindingState
  detectedAt: string
  stateChangedAt: string | null
}

/** A session row joined with its denormalised scan counts. Used by
 *  the Security page list and the Library row badge. */
export interface SessionWithFindingCounts {
  id: number
  sessionUuid: string
  title: string | null
  startedAt: string
  /** Active findings of any severity. */
  findingCount: number
  /** Active findings whose kind is in `HIGH_SEVERITY_KINDS`. */
  highCount: number
  /** Lifetime count of purged findings on this session. Combined with
   *  scan_completed_at + a zero findingCount, lets the Library row
   *  show an "all-resolved" check rather than a stale red badge. */
  purgedCount: number
  scanCompletedAt: string | null
  /** Sources name ('claude' / 'codex' / 'gemini'). */
  source: string
  /** Number of non-sidechain messages in the session. */
  messageCount: number
  /** Model identifier as captured at sync time. May be null for
   *  sessions where the parser couldn't infer it. */
  model: string | null
  /** Working directory captured when the session started; used to
   *  build the resume-CLI command and the "Copy terminal command"
   *  menu action. Null when the parser couldn't infer it. */
  cwd: string | null
  /** Human-readable project name, e.g. "spool". Surfaced at the head
   *  of the session card's meta row so users can locate the session
   *  in the Library at a glance. */
  projectDisplayName: string | null
}

/** Row in the Security page's Risk-by-category panel. One per kind
 *  that has ≥ 1 active finding; categories with zero counts are not
 *  emitted. */
export interface RiskByCategoryRow {
  kind: SensitiveKind
  severity: Severity
  count: number
  /** Distinct sessions containing ≥ 1 active finding of this kind. */
  sessions: number
}

/** Scope of a Dismiss action.
 *   session — add to allowlist_session for this finding's session
 *   global  — add to allowlist_global; all matching findings across
 *             every session auto-dismiss on next scan */
export interface DismissScope {
  scope: 'session' | 'global'
  /** Required when scope === 'session'. */
  sessionId?: number
}

/** Change events emitted on the worker's PubSub stream and forwarded
 *  to renderers via IPC. Consumers should treat unknown `type` values
 *  as no-ops (forward-compat). */
export type FindingsChange =
  | { type: 'inserted'; sessionId: number }
  | { type: 'state-changed'; sessionId: number; findingId: number; state: FindingState }
  | { type: 'session-rescanned'; sessionId: number }

/** Snapshot of the scan worker's transient state. The DB stores
 *  scan_profile / scan_completed_at; queued and scanning are
 *  worker-memory only — they reset on restart. */
export interface ScanStatus {
  /** Sessions waiting for a slot in the worker queue. */
  queued: number
  /** Session currently being scanned, or null when idle. */
  scanning: number | null
  /** When in backfill mode, sessions still to process; 0 otherwise. */
  backfillRemaining: number
  /** Composite identifier for the active provider set, e.g.
   *  'regex@3' or 'regex@3,pf@1.5b-q4'. Persisted on
   *  sessions.scan_profile to detect rescan candidates after
   *  provider configuration changes. */
  currentProfile: string
}

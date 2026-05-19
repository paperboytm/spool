// Shapes for the publish IPC bridge. Mirrors the wire format the
// share-backend accepts (`packages/share-backend/src/publish/validators.ts`).
// Kept in `shared/` because both the main-process IPC handler and the
// renderer's modal/button need to agree on the same types.
//
// New fields here MUST be additive — the backend's zod schema is the
// authoritative source of truth and adding required fields here without
// the server side first would reject every publish.

export type SnapshotTurnRole = 'user' | 'assistant' | 'system' | 'tool'

export interface SnapshotTurn {
  id: string
  role: SnapshotTurnRole
  content: string
  /** Informational only — true when the publish-time redact pass
   *  rewrote this turn's body. The Reader doesn't render anything for
   *  it today; reserved for a forward-compat "[content was edited by
   *  author]" badge. */
  redacted?: boolean
}

export interface SnapshotEditorOpts {
  template: string
  paper: string
  typeface: string
  colorway: string
  density: 'compact' | 'relaxed'
  masthead: boolean
  colophon: boolean
  avatars: boolean
  show_byline: boolean
}

export interface Snapshot {
  schema_version: 1
  source: {
    kind: 'spool-session' | 'imported-file' | 'imported-jsonl'
    origin_hint?: string
    captured_at: string
  }
  conversation: {
    title: string
    turns: SnapshotTurn[]
    turn_order: string[]
    hidden_turns: string[]
  }
  editor_opts: SnapshotEditorOpts
}

export type Visibility = 'unlisted' | 'profile-listed'

export interface PublishRequestBody {
  snapshot: Snapshot
  visibility: Visibility
  /** Local draft id this publish originates from. The backend persists
   *  it on the share row so the renderer can later look up "is this
   *  draft already published?" without scraping titles or hashing
   *  snapshots. Required for all v0.5.0+ clients. */
  draft_id: string
  /** Idempotency token derived from the publish payload (snapshot +
   *  visibility + expires_at). Retrying the same intent after a
   *  dropped response reuses the same token, and the backend
   *  short-circuits to the prior result instead of creating a
   *  duplicate share. A re-edited intent produces a different hash,
   *  so the backend treats it as a fresh publish. */
  idempotency_key: string
  expires_at?: string
  /** When set, the backend overwrites the existing share at this slug
   *  (republish path). The slug, user, and draft_id must all match. */
  override_slug?: string
}

export interface PublishSuccess {
  id: string
  url: string
  version: number
}

export interface PublishErrorBody {
  error: string
  detail?: string
  // Validation issue list when the request shape itself failed zod.
  issues?: unknown
}

/** Cache-row shape duplicated here so this shared file stays free of
 *  the @spool-lab/core import. Field set is intentionally aligned with
 *  `PublishedShareCacheItem` in core — keep them in sync. The
 *  consuming side asserts assignability via a `satisfies`-style check
 *  to surface field drift at compile time. */
export interface PublishedRow {
  id: string
  title: string
  visibility: Visibility
  version: number
  published_at: number
  revoked_at: number | null
  expires_at: number | null
  draft_id: string | null
  client_request_id: string | null
  updated_at: number
}

export type PublishResult =
  | {
      ok: true
      data: PublishSuccess
      /** The cache row main just wrote. Surfaced here so the renderer
       *  can update its state without a separate getPublishedByDraft
       *  IPC — eliminating the race where an in-flight myShares poll's
       *  `replaceAll` stomps the freshly-written row between the
       *  publish-IPC response and the renderer's cache re-read. */
      row: PublishedRow
    }
  | { ok: false; status: number; error: PublishErrorBody }

export interface MyShare {
  id: string
  title: string
  visibility: Visibility
  expires_at: number | null
  version: number
  published_at: number
  republished_at: number | null
  revoked_at: number | null
  /** Backend's link back to the draft this share was published from.
   *  Non-null for shares published by v0.5.0+ clients. Pre-existing
   *  shares published before the column landed come back null until
   *  the user republishes (or runs the migration backfill). */
  draft_id: string | null
  /** Publish-time idempotency token (content hash). The editor compares
   *  the live draft's hash against this to surface the "Unpublished
   *  edits" badge. Nullable for the same legacy-row reason as draft_id. */
  client_request_id: string | null
}

export interface MySharesResponse {
  items: MyShare[]
}

export interface HandleCheckResponse {
  available: boolean
  reason?: string
}

export interface HandleClaimResponse {
  handle: string
}

/** Response from `POST /api/me/delete` — backend confirms the cool-off
 *  schedule and returns the epoch-millis at which the deletion executes
 *  unless the user calls `DELETE /api/me/delete` first. */
export interface ScheduleDeleteResponse {
  scheduled_at: number
  /** Defaults to 24h after `scheduled_at` when omitted by the server. */
  execute_at?: number
}

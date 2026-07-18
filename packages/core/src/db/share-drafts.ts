import type Database from 'better-sqlite3'

/** Mirrors the CHECK constraint in the v11 migration. Kept as a local
 *  string union so @spool/core stays free of any @spool/share-kit
 *  dependency; the app layer reconciles this with share-kit's Snapshot
 *  type when it parses snapshot_json. */
export type ShareDraftSourceKind =
  | 'spool-session'
  | 'pasted-url'
  | 'imported-file'
  | 'imported-jsonl'

/** Row shape for the Shares grid: full metadata plus the slim
 *  `preview_json` blob. Excludes `snapshot_json` so list queries don't
 *  haul hundreds of KB per row over IPC. */
export interface ShareDraftListItem {
  draft_id: string
  source_kind: ShareDraftSourceKind
  source_origin: string | null
  title: string
  preview_json: string
  created_at: string
  updated_at: string
}

/** Row shape for the editor: ShareDraftListItem + the full document
 *  blob. Returned by getShareDraft, never by listShareDrafts. */
export interface ShareDraftRow extends ShareDraftListItem {
  snapshot_json: string
}

export interface UpsertShareDraftInput {
  draft_id: string
  source_kind: ShareDraftSourceKind
  source_origin: string | null
  title: string
  snapshot_json: string
  preview_json: string
}

const LIST_COLS =
  'draft_id, source_kind, source_origin, title, preview_json, created_at, updated_at'
const FULL_COLS = `${LIST_COLS}, snapshot_json`

/** Lists drafts for the Shares grid. Intentionally omits `snapshot_json`
 *  so the IPC payload stays small even when the user has hundreds of
 *  drafts. The editor fetches the full row via getShareDraft. */
export function listShareDrafts(
  db: Database.Database,
  opts: { limit?: number } = {},
): ShareDraftListItem[] {
  const limit = opts.limit ?? 200
  return db
    .prepare(`SELECT ${LIST_COLS} FROM share_drafts ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as ShareDraftListItem[]
}

export function getShareDraft(db: Database.Database, draftId: string): ShareDraftRow | null {
  return (
    (db.prepare(`SELECT ${FULL_COLS} FROM share_drafts WHERE draft_id = ?`).get(draftId) as
      | ShareDraftRow
      | undefined) ?? null
  )
}

/**
 * Insert a new draft or update an existing one in place. Touches
 * updated_at on every call; preserves created_at on update. Both JSON
 * blobs are written together — callers must keep them in sync.
 */
export function upsertShareDraft(db: Database.Database, input: UpsertShareDraftInput): void {
  db.prepare(
    `INSERT INTO share_drafts (draft_id, source_kind, source_origin, title, snapshot_json, preview_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(draft_id) DO UPDATE SET
       source_kind   = excluded.source_kind,
       source_origin = excluded.source_origin,
       title         = excluded.title,
       snapshot_json = excluded.snapshot_json,
       preview_json  = excluded.preview_json,
       updated_at    = excluded.updated_at`,
  ).run(
    input.draft_id,
    input.source_kind,
    input.source_origin,
    input.title,
    input.snapshot_json,
    input.preview_json,
  )
}

export function deleteShareDraft(db: Database.Database, draftId: string): void {
  db.prepare('DELETE FROM share_drafts WHERE draft_id = ?').run(draftId)
}

/**
 * Count drafts that originated from a given Spool session. Drives the
 * "N shares from this session" chip on SessionDetail (PR 4).
 */
export function countDraftsBySession(db: Database.Database, sessionUuid: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM share_drafts
       WHERE source_kind = 'spool-session' AND source_origin = ?`,
    )
    .get(sessionUuid) as { n: number }
  return row.n
}

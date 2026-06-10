import type Database from 'better-sqlite3'

/** Row shape persisted in `published_shares_cache`. Mirrors the
 *  `MyShare` payload the share-backend returns from `/api/me/shares`,
 *  with timestamps stored as epoch-millis integers. `draft_id` is the
 *  link back to share_drafts; non-null for every share published from
 *  v0.5.0 onward, nullable for pre-existing rows surfaced through
 *  legacy `/api/me/shares` responses. `client_request_id` is the
 *  publish-time content hash, used by the editor's "Unpublished
 *  edits" badge to detect drift between the live draft and the
 *  currently-published snapshot. */
export interface PublishedShareCacheItem {
  id: string
  title: string
  visibility: string
  version: number
  published_at: number
  revoked_at: number | null
  draft_id: string | null
  client_request_id: string | null
  updated_at: number
}

const COLS =
  'id, title, visibility, version, published_at, revoked_at, draft_id, client_request_id, updated_at'

/** Returns all cached published shares ordered by publish date desc. */
export function listAll(db: Database.Database): PublishedShareCacheItem[] {
  return db
    .prepare(`SELECT ${COLS} FROM published_shares_cache ORDER BY published_at DESC`)
    .all() as PublishedShareCacheItem[]
}

/** Look up the most recent share for a given draft, or null. The index
 *  on draft_id makes this O(log n); we return the most recently
 *  published row in the rare case multiple shares share a draft_id
 *  (e.g., a revoke + re-publish that bumped the slug). */
export function getByDraftId(
  db: Database.Database,
  draftId: string,
): PublishedShareCacheItem | null {
  return (
    (db
      .prepare(
        `SELECT ${COLS} FROM published_shares_cache
         WHERE draft_id = ?
         ORDER BY published_at DESC
         LIMIT 1`,
      )
      .get(draftId) as PublishedShareCacheItem | undefined) ?? null
  )
}

/** Per-row upsert. Useful for partial updates (e.g., a single revoke);
 *  the renderer typically uses {@link replaceAll} for full syncs. */
export function upsertMany(
  db: Database.Database,
  items: ReadonlyArray<PublishedShareCacheItem>,
): void {
  const stmt = db.prepare(
    `INSERT INTO published_shares_cache (${COLS})
     VALUES (@id, @title, @visibility, @version, @published_at, @revoked_at, @draft_id, @client_request_id, @updated_at)
     ON CONFLICT(id) DO UPDATE SET
       title             = excluded.title,
       visibility        = excluded.visibility,
       version           = excluded.version,
       published_at      = excluded.published_at,
       revoked_at        = excluded.revoked_at,
       draft_id          = excluded.draft_id,
       client_request_id = excluded.client_request_id,
       updated_at        = excluded.updated_at`,
  )
  db.transaction(() => {
    for (const it of items) stmt.run(it)
  })()
}

/** Replaces the cache contents with `items` (wipes rows not present). */
export function replaceAll(
  db: Database.Database,
  items: ReadonlyArray<PublishedShareCacheItem>,
): void {
  db.transaction(() => {
    db.prepare('DELETE FROM published_shares_cache').run()
    const stmt = db.prepare(
      `INSERT INTO published_shares_cache (${COLS})
       VALUES (@id, @title, @visibility, @version, @published_at, @revoked_at, @draft_id, @client_request_id, @updated_at)`,
    )
    for (const it of items) stmt.run(it)
  })()
}

export function clearAll(db: Database.Database): void {
  db.prepare('DELETE FROM published_shares_cache').run()
}

/** Flip a single row's revoked_at without touching the rest. Used by
 *  the renderer-side revoke IPC so the cache (and any open editor)
 *  reflects the unpublish without waiting for the next myShares poll. */
export function markRevoked(
  db: Database.Database,
  id: string,
  revokedAt: number,
): void {
  db.prepare(
    `UPDATE published_shares_cache
     SET revoked_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(revokedAt, revokedAt, id)
}

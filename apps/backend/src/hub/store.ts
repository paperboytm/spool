import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

// D1 access for the hub. Chunked IN() queries stay under D1's ~100 bound
// parameter ceiling; object inserts go through db.batch() so a 4000-line
// upload is a handful of round trips, not 4000.

const IN_CHUNK = 80

export type HubSessionRow = {
  sid: string
  owner_user_id: string
  root: string
  record_count: number
  sig: string | null
  card_json: string | null
  // Legacy persistence name; the Hub contract calls this Summary.
  note_md: string | null
  lineage_json: string | null
  view_oid: string | null
  spool_file_oid: string | null
  visibility: string
  withdrawn_at: number | null
  created_at: number
  updated_at: number
}

export type ObjectLocation = {
  oid: string
  pack_key: string
  offset: number
  length: number
}

export async function getHubSession(db: D1Database, sid: string): Promise<HubSessionRow | null> {
  return db.prepare('SELECT * FROM hub_sessions WHERE sid=?').bind(sid).first<HubSessionRow>()
}

export async function upsertHubSession(db: D1Database, row: HubSessionUpsert): Promise<void> {
  await prepareHubSessionUpsert(db, row).run()
}

export type HubSessionUpsert = {
  sid: string
  ownerUserId: string
  root: string
  recordCount: number
  sig: string | null
  cardJson: string | null
  summaryMd: string | null
  lineageJson: string | null
  viewOid: string
  spoolFileOid: string | null
  now: number
}

export function prepareHubSessionUpsert(
  db: D1Database,
  row: HubSessionUpsert,
): D1PreparedStatement {
  // ON CONFLICT keeps owner_user_id / visibility / created_at and clears any
  // tombstone: an author re-sharing a withdrawn session is an explicit
  // re-publish decision.
  return db
    .prepare(
      'INSERT INTO hub_sessions (sid, owner_user_id, root, record_count, sig, card_json, note_md, lineage_json, view_oid, spool_file_oid, visibility, withdrawn_at, created_at, updated_at) ' +
        "VALUES (?,?,?,?,?,?,?,?,?,?,'unlisted',NULL,?,?) " +
        'ON CONFLICT(sid) DO UPDATE SET root=excluded.root, record_count=excluded.record_count, sig=excluded.sig, card_json=excluded.card_json, note_md=excluded.note_md, lineage_json=excluded.lineage_json, view_oid=excluded.view_oid, spool_file_oid=excluded.spool_file_oid, withdrawn_at=NULL, updated_at=excluded.updated_at',
    )
    .bind(
      row.sid,
      row.ownerUserId,
      row.root,
      row.recordCount,
      row.sig,
      row.cardJson,
      row.summaryMd,
      row.lineageJson,
      row.viewOid,
      row.spoolFileOid,
      row.now,
      row.now,
    )
}

export async function withdrawHubSession(
  db: D1Database,
  sid: string,
  ownerUserId: string,
  now: number,
): Promise<boolean> {
  const result = await db
    .prepare('UPDATE hub_sessions SET withdrawn_at=?, updated_at=? WHERE sid=? AND owner_user_id=?')
    .bind(now, now, sid, ownerUserId)
    .run()
  return result.meta.changes > 0
}

/** Which of `oids` this user has already uploaded. */
export async function presentOids(
  db: D1Database,
  ownerUserId: string,
  oids: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>()
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db
      .prepare(`SELECT oid FROM hub_objects WHERE owner_user_id=? AND oid IN (${placeholders})`)
      .bind(ownerUserId, ...chunk)
      .all<{ oid: string }>()
    for (const row of rows.results) present.add(row.oid)
  }
  return present
}

export async function locateObjects(
  db: D1Database,
  ownerUserId: string,
  oids: readonly string[],
): Promise<Map<string, ObjectLocation>> {
  const located = new Map<string, ObjectLocation>()
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db
      .prepare(
        `SELECT oid, pack_key, offset, length FROM hub_objects WHERE owner_user_id=? AND oid IN (${placeholders})`,
      )
      .bind(ownerUserId, ...chunk)
      .all<ObjectLocation>()
    for (const row of rows.results) located.set(row.oid, row)
  }
  return located
}

export async function insertObjects(
  db: D1Database,
  ownerUserId: string,
  packKey: string,
  placements: readonly { oid: string; offset: number; length: number }[],
  now: number,
): Promise<void> {
  const statements = placements.map((p) =>
    db
      .prepare(
        'INSERT OR IGNORE INTO hub_objects (owner_user_id, oid, size, pack_key, offset, length, created_at) VALUES (?,?,?,?,?,?,?)',
      )
      .bind(ownerUserId, p.oid, p.length, packKey, p.offset, p.length, now),
  )
  for (let start = 0; start < statements.length; start += IN_CHUNK) {
    await db.batch(statements.slice(start, start + IN_CHUNK))
  }
}

export async function userStorageBytes(db: D1Database, ownerUserId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(size),0) AS total FROM hub_objects WHERE owner_user_id=?')
    .bind(ownerUserId)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export type HubAuthor = {
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export async function getHubAuthor(db: D1Database, userId: string): Promise<HubAuthor> {
  const user = await db
    .prepare(
      'SELECT name, avatar_url, display_name, custom_avatar_id, avatar_visible FROM users WHERE id=? AND deleted_at IS NULL',
    )
    .bind(userId)
    .first<{
      name: string | null
      avatar_url: string | null
      display_name: string | null
      custom_avatar_id: string | null
      avatar_visible: number | null
    }>()
  const handleRow = await db
    .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL')
    .bind(userId)
    .first<{ handle: string }>()
  if (!user) return { handle: handleRow?.handle ?? null, displayName: null, avatarUrl: null }
  const avatarVisible = (user.avatar_visible ?? 1) === 1
  const avatarUrl = !avatarVisible
    ? null
    : user.custom_avatar_id
      ? `/api/avatars/${user.custom_avatar_id}`
      : user.avatar_url
  return {
    handle: handleRow?.handle ?? null,
    displayName: user.display_name ?? user.name,
    avatarUrl,
  }
}

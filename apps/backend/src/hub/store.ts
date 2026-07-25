import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import { ApiError } from '../errors'

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
  /** Publish-time estimate frozen from the validated Session view. */
  cost_usd: number | null
  total_tokens: number | null
  visibility: string
  /** Resource tenant. NULL means personal; a value means the Team owns the
   *  Session and its object index even when the Team later publishes it. */
  team_id: string | null
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
  costUsd: number | null
  totalTokens: number | null
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
      'INSERT INTO hub_sessions (sid, owner_user_id, root, record_count, sig, card_json, note_md, lineage_json, view_oid, spool_file_oid, cost_usd, total_tokens, visibility, withdrawn_at, created_at, updated_at) ' +
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'unlisted',NULL,?,?) " +
        'ON CONFLICT(sid) DO UPDATE SET root=excluded.root, record_count=excluded.record_count, sig=excluded.sig, card_json=excluded.card_json, note_md=excluded.note_md, lineage_json=excluded.lineage_json, view_oid=excluded.view_oid, spool_file_oid=excluded.spool_file_oid, cost_usd=excluded.cost_usd, total_tokens=excluded.total_tokens, withdrawn_at=NULL, updated_at=excluded.updated_at',
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
      row.costUsd,
      row.totalTokens,
      row.now,
      row.now,
    )
}

export type AuthorizedHeadWrite = HubSessionUpsert & {
  actorUserId: string
  /** The tenant observed before doing any R2 or multi-statement preparation. */
  expectedTeamId: string | null
  expectedVisibility: string
  expectedWithdrawnAt: number | null
  expectedRoot: string | null
  expectedUpdatedAt: number | null
  expectedPublished: boolean
  /** The durable tenant and storage visibility after this commit. */
  targetTeamId: string | null
  targetVisibility: 'unlisted' | 'private'
  changeAccess: boolean
  clearWithdrawal: boolean
  requireTeamManager: boolean
}

/**
 * Insert a new head only while the actor and target Team authority validated
 * by the request are still current. This deliberately has no conflict handler:
 * a same-SID commit that wins after the preflight must raise a SQL constraint
 * error so D1 rolls back every later statement in the batch, including any
 * one-use Resume grant claim.
 */
export function prepareAuthorizedHeadInsert(
  db: D1Database,
  row: AuthorizedHeadWrite,
): D1PreparedStatement {
  const manager = row.requireTeamManager ? 1 : 0

  return db
    .prepare(
      `/* hub:authorized-head-insert */
       INSERT INTO hub_sessions
         (sid, owner_user_id, root, record_count, sig, card_json, note_md,
          lineage_json, view_oid, spool_file_oid, cost_usd, total_tokens,
          visibility, team_id,
          withdrawn_at, created_at, updated_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?
       WHERE EXISTS (
         SELECT 1 FROM users actor
         WHERE actor.id=? AND actor.deleted_at IS NULL
           AND actor.deletion_pending_until IS NULL
       )
       AND (? IS NULL OR EXISTS (
         SELECT 1
         FROM teams t
         JOIN team_memberships m ON m.team_id=t.id
         JOIN users actor_user ON actor_user.id=m.user_id
         WHERE t.id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
           AND m.user_id=? AND (?=0 OR m.role IN ('owner','admin'))
           AND actor_user.deleted_at IS NULL
           AND actor_user.deletion_pending_until IS NULL
       ))`,
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
      row.costUsd,
      row.totalTokens,
      row.targetVisibility,
      row.targetTeamId,
      row.now,
      row.now,
      row.actorUserId,
      row.targetTeamId,
      row.targetTeamId,
      row.actorUserId,
      manager,
    )
}

/**
 * Update an existing head only while the exact disclosure snapshot and Team
 * authority validated by the request are still current. A deletion, archive,
 * membership change, or competing head commit makes this a zero-row no-op.
 * Unlike an upsert, a deleted expected row can never be recreated here.
 */
export function prepareAuthorizedHeadUpdate(
  db: D1Database,
  row: AuthorizedHeadWrite,
): D1PreparedStatement {
  const manager = row.requireTeamManager ? 1 : 0
  const changeAccess = row.changeAccess ? 1 : 0
  const clearWithdrawal = row.clearWithdrawal ? 1 : 0
  const expectedPublished = row.expectedPublished ? 1 : 0

  return db
    .prepare(
      `/* hub:authorized-head-update */
       UPDATE hub_sessions
       SET root=?,
           record_count=?,
           sig=?,
           card_json=?,
           note_md=?,
           lineage_json=?,
           view_oid=?,
           spool_file_oid=?,
           cost_usd=?,
           total_tokens=?,
           visibility=CASE WHEN ?=1 THEN ? ELSE visibility END,
           team_id=CASE WHEN ?=1 THEN ? ELSE team_id END,
           withdrawn_at=CASE WHEN ?=1 THEN NULL ELSE withdrawn_at END,
           updated_at=?
       WHERE sid=?
         AND owner_user_id=?
         AND root=?
         AND updated_at=?
         AND team_id IS ?
         AND visibility=?
         AND withdrawn_at IS ?
         AND (
           (?=1 AND EXISTS (
             SELECT 1 FROM hub_session_discovery d WHERE d.sid=hub_sessions.sid
           ))
           OR
           (?=0 AND NOT EXISTS (
             SELECT 1 FROM hub_session_discovery d WHERE d.sid=hub_sessions.sid
           ))
         )
         AND EXISTS (
           SELECT 1 FROM users actor
           WHERE actor.id=? AND actor.deleted_at IS NULL
             AND actor.deletion_pending_until IS NULL
         )
         AND (? IS NULL OR EXISTS (
           SELECT 1
           FROM teams t
           JOIN team_memberships m ON m.team_id=t.id
           JOIN users actor_user ON actor_user.id=m.user_id
           WHERE t.id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
             AND m.user_id=? AND (?=0 OR m.role IN ('owner','admin'))
             AND actor_user.deleted_at IS NULL
             AND actor_user.deletion_pending_until IS NULL
         ))`,
    )
    .bind(
      row.root,
      row.recordCount,
      row.sig,
      row.cardJson,
      row.summaryMd,
      row.lineageJson,
      row.viewOid,
      row.spoolFileOid,
      row.costUsd,
      row.totalTokens,
      changeAccess,
      row.targetVisibility,
      changeAccess,
      row.targetTeamId,
      clearWithdrawal,
      row.now,
      row.sid,
      row.actorUserId,
      row.expectedRoot,
      row.expectedUpdatedAt,
      row.expectedTeamId,
      row.expectedVisibility,
      row.expectedWithdrawnAt,
      expectedPublished,
      expectedPublished,
      row.actorUserId,
      row.targetTeamId,
      row.targetTeamId,
      row.actorUserId,
      manager,
    )
}

export type AuthorizedVisibilityUpdate = {
  sid: string
  actorUserId: string
  expectedTeamId: string | null
  expectedVisibility: string
  expectedPublished: boolean
  expectedRoot: string
  expectedUpdatedAt: number
  targetTeamId: string | null
  targetVisibility: 'unlisted' | 'private'
  lineageJson: string | null
  requireTargetManager: boolean
  now: number
}

/** Final disclosure mutation with both source and target tenant authority. */
export function prepareAuthorizedVisibilityUpdate(
  db: D1Database,
  change: AuthorizedVisibilityUpdate,
): D1PreparedStatement {
  const expectedPublished = change.expectedPublished ? 1 : 0
  const requireTargetManager = change.requireTargetManager ? 1 : 0
  return db
    .prepare(
      `/* hub:authorized-visibility-update */
       UPDATE hub_sessions AS session
       SET visibility=?, team_id=?, lineage_json=?, updated_at=?
       WHERE session.sid=?
         AND session.team_id IS ?
         AND session.visibility=?
         AND session.root=?
         AND session.updated_at=?
         AND session.withdrawn_at IS NULL
         AND EXISTS (
           SELECT 1 FROM users actor
           WHERE actor.id=? AND actor.deleted_at IS NULL
             AND actor.deletion_pending_until IS NULL
         )
         AND (
           (?=1 AND EXISTS (
             SELECT 1 FROM hub_session_discovery d WHERE d.sid=session.sid
           ))
           OR
           (?=0 AND NOT EXISTS (
             SELECT 1 FROM hub_session_discovery d WHERE d.sid=session.sid
           ))
         )
         AND (
           (? IS NULL AND session.owner_user_id=?)
           OR
           (? IS NOT NULL AND EXISTS (
             SELECT 1
             FROM teams source_team
             JOIN team_memberships source_member ON source_member.team_id=source_team.id
             JOIN users source_actor ON source_actor.id=source_member.user_id
             WHERE source_team.id=? AND source_team.archived_at IS NULL
               AND source_team.deletion_pending_until IS NULL
               AND source_member.user_id=? AND source_member.role IN ('owner','admin')
               AND source_actor.deleted_at IS NULL
               AND source_actor.deletion_pending_until IS NULL
           ))
         )
         AND (
           ? IS NULL OR EXISTS (
             SELECT 1
             FROM teams target_team
             JOIN team_memberships target_member ON target_member.team_id=target_team.id
             JOIN users target_actor ON target_actor.id=target_member.user_id
             WHERE target_team.id=? AND target_team.archived_at IS NULL
               AND target_team.deletion_pending_until IS NULL
               AND target_member.user_id=?
               AND (?=0 OR target_member.role IN ('owner','admin'))
               AND target_actor.deleted_at IS NULL
               AND target_actor.deletion_pending_until IS NULL
           )
         )`,
    )
    .bind(
      change.targetVisibility,
      change.targetTeamId,
      change.lineageJson,
      change.now,
      change.sid,
      change.expectedTeamId,
      change.expectedVisibility,
      change.expectedRoot,
      change.expectedUpdatedAt,
      change.actorUserId,
      expectedPublished,
      expectedPublished,
      change.expectedTeamId,
      change.actorUserId,
      change.expectedTeamId,
      change.expectedTeamId,
      change.actorUserId,
      change.targetTeamId,
      change.targetTeamId,
      change.actorUserId,
      requireTargetManager,
    )
}

/** Owners may withdraw personal Sessions; only current Team managers may
 * withdraw Team-owned Sessions. The tenant snapshot prevents a personal read
 * racing a transfer and then mutating the newly Team-owned resource. */
export function prepareAuthorizedWithdrawal(
  db: D1Database,
  args: { sid: string; actorUserId: string; expectedTeamId: string | null; now: number },
): D1PreparedStatement {
  return db
    .prepare(
      `/* hub:authorized-withdraw */
       UPDATE hub_sessions AS session
       SET withdrawn_at=COALESCE(session.withdrawn_at, ?), updated_at=?
       WHERE session.sid=? AND session.team_id IS ?
         AND (
           (? IS NULL AND session.owner_user_id=?)
           OR
           (? IS NOT NULL AND EXISTS (
             SELECT 1
             FROM teams t
             JOIN team_memberships m ON m.team_id=t.id
             WHERE t.id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
               AND m.user_id=? AND m.role IN ('owner','admin')
           ))
         )`,
    )
    .bind(
      args.now,
      args.now,
      args.sid,
      args.expectedTeamId,
      args.expectedTeamId,
      args.actorUserId,
      args.expectedTeamId,
      args.expectedTeamId,
      args.actorUserId,
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

/** Which of `oids` are already addressable inside a Team tenant. Keeping a
 *  separate table prevents cross-tenant dedup probes even when two mappings
 *  happen to reference the same immutable physical pack. */
export async function presentTeamOids(
  db: D1Database,
  teamId: string,
  oids: readonly string[],
): Promise<Set<string>> {
  const present = new Set<string>()
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db
      .prepare(`SELECT oid FROM hub_team_objects WHERE team_id=? AND oid IN (${placeholders})`)
      .bind(teamId, ...chunk)
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

export async function locateTeamObjects(
  db: D1Database,
  teamId: string,
  oids: readonly string[],
): Promise<Map<string, ObjectLocation>> {
  const located = new Map<string, ObjectLocation>()
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const rows = await db
      .prepare(
        `SELECT oid, pack_key, offset, length FROM hub_team_objects WHERE team_id=? AND oid IN (${placeholders})`,
      )
      .bind(teamId, ...chunk)
      .all<ObjectLocation>()
    for (const row of rows.results) located.set(row.oid, row)
  }
  return located
}

export function locateSessionObjects(
  db: D1Database,
  session: Pick<HubSessionRow, 'owner_user_id' | 'team_id'>,
  oids: readonly string[],
): Promise<Map<string, ObjectLocation>> {
  return session.team_id
    ? locateTeamObjects(db, session.team_id, oids)
    : locateObjects(db, session.owner_user_id, oids)
}

/**
 * Make personal objects addressable by a Team without copying bytes during
 * the disclosure-changing request. The immutable pack stays private behind
 * D1; the account-deletion sweep re-homes Team references before deleting a
 * personal pack. This keeps a large Session transfer bounded and atomic at
 * the authorization boundary.
 */
export async function aliasPersonalObjectsToTeam(
  db: D1Database,
  ownerUserId: string,
  teamId: string,
  oids: readonly string[],
  now: number,
  requireTeamManager: boolean,
): Promise<void> {
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    try {
      await db
        .prepare(
          `/* hub:authorized-team-alias */
           INSERT OR IGNORE INTO hub_team_objects
             (team_id, oid, size, pack_key, offset, length, created_at)
           SELECT ?, source.oid, source.size, source.pack_key, source.offset, source.length, ?
           FROM hub_objects source
           WHERE source.owner_user_id=? AND source.oid IN (${placeholders})
             AND EXISTS (
               SELECT 1
               FROM teams t
               JOIN team_memberships m ON m.team_id=t.id
               WHERE t.id=? AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
                 AND m.user_id=? AND (?=0 OR m.role IN ('owner','admin'))
             )`,
        )
        .bind(teamId, now, ownerUserId, ...chunk, teamId, ownerUserId, requireTeamManager ? 1 : 0)
        .run()
    } catch (error) {
      if (isTeamStorageQuotaError(error)) {
        throw new ApiError('UNPROCESSABLE', 'Team storage quota exceeded')
      }
      throw error
    }
  }

  const present = await presentTeamOids(db, teamId, oids)
  if (oids.some((oid) => !present.has(oid))) throw new ApiError('NOT_FOUND')
}

export function prepareAuthorizedPersonalObjectAliases(
  db: D1Database,
  args: {
    sid: string
    ownerUserId: string
    actorUserId: string
    teamId: string
    root: string
    updatedAt: number
    visibility: 'unlisted' | 'private'
    oids: readonly string[]
    now: number
    requireTeamManager: boolean
  },
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = []
  for (let start = 0; start < args.oids.length; start += IN_CHUNK) {
    const chunk = args.oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    statements.push(
      db
        .prepare(
          `/* hub:authorized-team-alias-after-commit */
           INSERT OR IGNORE INTO hub_team_objects
             (team_id, oid, size, pack_key, offset, length, created_at)
           SELECT ?, source.oid, source.size, source.pack_key, source.offset, source.length, ?
           FROM hub_objects source
           WHERE source.owner_user_id=? AND source.oid IN (${placeholders})
             AND EXISTS (
               SELECT 1
               FROM hub_sessions session
               JOIN teams team ON team.id=session.team_id
               JOIN team_memberships member ON member.team_id=team.id
               JOIN users actor ON actor.id=member.user_id
               WHERE session.sid=? AND session.owner_user_id=?
                 AND session.team_id=? AND session.root=? AND session.updated_at=?
                 AND session.visibility=? AND session.withdrawn_at IS NULL
                 AND team.archived_at IS NULL AND team.deletion_pending_until IS NULL
                 AND member.user_id=? AND (?=0 OR member.role IN ('owner','admin'))
                 AND actor.deleted_at IS NULL AND actor.deletion_pending_until IS NULL
             )`,
        )
        .bind(
          args.teamId,
          args.now,
          args.ownerUserId,
          ...chunk,
          args.sid,
          args.ownerUserId,
          args.teamId,
          args.root,
          args.updatedAt,
          args.visibility,
          args.actorUserId,
          args.requireTeamManager ? 1 : 0,
        ),
    )
  }
  return statements
}

export function isTeamStorageQuotaError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.toLowerCase().includes('team storage quota exceeded')
  )
}

export async function teamStorageBytes(db: D1Database, teamId: string): Promise<number> {
  const row = await db
    .prepare('SELECT COALESCE(SUM(size),0) AS total FROM hub_team_objects WHERE team_id=?')
    .bind(teamId)
    .first<{ total: number }>()
  return row?.total ?? 0
}

export async function personalObjectBytes(
  db: D1Database,
  ownerUserId: string,
  oids: readonly string[],
): Promise<number> {
  let total = 0
  for (let start = 0; start < oids.length; start += IN_CHUNK) {
    const chunk = oids.slice(start, start + IN_CHUNK)
    const placeholders = chunk.map(() => '?').join(',')
    const row = await db
      .prepare(
        `SELECT COALESCE(SUM(size),0) AS total FROM hub_objects WHERE owner_user_id=? AND oid IN (${placeholders})`,
      )
      .bind(ownerUserId, ...chunk)
      .first<{ total: number }>()
    total += row?.total ?? 0
  }
  return total
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
      ? `/api/avatars/${encodeURIComponent(userId)}?v=${encodeURIComponent(user.custom_avatar_id)}`
      : user.avatar_url
  return {
    handle: handleRow?.handle ?? null,
    displayName: user.display_name ?? user.name,
    avatarUrl,
  }
}

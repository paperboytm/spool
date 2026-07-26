import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from './errors'

// Handle-based owner/Project routes are part of the active product surface.
// Keep an emergency off switch for incident response, but default to enabled
// so an omitted Pages variable cannot make seeded owner URLs disappear.
export function profilesEnabled(env: { PROFILES_ENABLED?: string }): boolean {
  return env.PROFILES_ENABLED !== '0'
}

// Two flavours of reserved name, merged into one set:
//   1) URL-routing words that already mean something on spool.new
//      (collide with /api/*, /me, /settings, etc.)
//   2) Brand / impersonation guards. Cheap to add now; expensive to
//      take back from a squatter after launch.
const RESERVED = new Set([
  // routing
  'admin',
  'support',
  'help',
  'api',
  'www',
  'me',
  'mine',
  'editor',
  'share',
  'shares',
  'snapshot',
  'snapshots',
  's',
  'u',
  'user',
  'users',
  'profile',
  'profiles',
  'settings',
  'login',
  'signin',
  'signout',
  'signup',
  'register',
  'terms',
  'privacy',
  'dmca',
  'report',
  'abuse',
  'mail',
  'root',
  'system',
  'anonymous',
  'deleted',
  'undefined',
  'null',
  'about',
  'contact',
  'home',
  'docs',
  'blog',
  'auth',
  'oauth',
  'static',
  'assets',
  'public',
  'feed',
  'rss',
  'app',
  'apps',
  'dev',
  'new',
  'edit',
  // brand / impersonation
  'spool',
  'spoollab',
  'spool-lab',
  'staff',
  'team',
  'official',
  'anthropic',
  'claude',
  'paperboy',
])

// ASCII-only on purpose — closes off Unicode-homoglyph spoofs
// (Cyrillic `о`, Greek `α`, etc.) at the validation layer.
const RE = /^[a-z][a-z0-9_-]{2,31}$/

export type HandleValidation = { ok: true; handle: string } | { ok: false; reason: string }

export function validateHandle(raw: unknown): HandleValidation {
  if (typeof raw !== 'string') return { ok: false, reason: 'not a string' }
  const h = raw.trim().toLowerCase()
  if (!RE.test(h)) return { ok: false, reason: 'invalid format' }
  if (RESERVED.has(h)) return { ok: false, reason: 'reserved' }
  return { ok: true, handle: h }
}

export async function activeTeamHandle(db: D1Database, teamId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT handle FROM handles WHERE team_id=? AND released_at IS NULL LIMIT 1')
    .bind(teamId)
    .first<{ handle: string }>()
  return row?.handle ?? null
}

export async function activeUserHandle(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT handle FROM handles WHERE user_id=? AND released_at IS NULL LIMIT 1')
    .bind(userId)
    .first<{ handle: string }>()
  return row?.handle ?? null
}

/**
 * Gives a live Project owner a stable route identity without taking over the
 * owner-controlled rename surface. Automatic handles always include an opaque
 * owner-id suffix, so common names do not become a first-come race.
 */
export async function ensureOwnerHandle(
  db: D1Database,
  args:
    | { actorUserId: string; userId: string; teamId: null; label?: string; now: number }
    | { actorUserId: string; userId: null; teamId: string; label?: string; now: number },
): Promise<string> {
  const current =
    args.teamId === null
      ? await activeUserHandle(db, args.userId)
      : await activeTeamHandle(db, args.teamId)
  if (current) return current

  const owner =
    args.teamId === null
      ? await db
          .prepare(
            `SELECT COALESCE(display_name,name) AS label
             FROM users
             WHERE id=? AND id=? AND deleted_at IS NULL
               AND deletion_pending_until IS NULL`,
          )
          .bind(args.userId, args.actorUserId)
          .first<{ label: string | null }>()
      : await db
          .prepare(
            `SELECT t.name AS label
             FROM teams t
             JOIN team_memberships membership ON membership.team_id=t.id
             JOIN users actor ON actor.id=membership.user_id
             WHERE t.id=? AND membership.user_id=?
               AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
               AND actor.deleted_at IS NULL AND actor.deletion_pending_until IS NULL`,
          )
          .bind(args.teamId, args.actorUserId)
          .first<{ label: string }>()
  if (!owner) throw new ApiError('NOT_FOUND')

  const ownerId = args.teamId ?? args.userId
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = automaticHandle(
      args.label ?? owner.label ?? '',
      ownerId,
      args.teamId ? 'team' : 'user',
      attempt,
    )
    try {
      const result =
        args.teamId === null
          ? await db
              .prepare(
                `INSERT INTO handles
                   (handle, user_id, team_id, claimed_at, released_at)
                 SELECT ?,id,NULL,?,NULL
                 FROM users
                 WHERE id=? AND id=? AND deleted_at IS NULL
                   AND deletion_pending_until IS NULL`,
              )
              .bind(handle, args.now, args.userId, args.actorUserId)
              .run()
          : await db
              .prepare(
                `INSERT INTO handles
                   (handle, user_id, team_id, claimed_at, released_at)
                 SELECT ?,NULL,t.id,?,NULL
                 FROM teams t
                 JOIN team_memberships membership ON membership.team_id=t.id
                 JOIN users actor ON actor.id=membership.user_id
                 WHERE t.id=? AND membership.user_id=?
                   AND t.archived_at IS NULL AND t.deletion_pending_until IS NULL
                   AND actor.deleted_at IS NULL AND actor.deletion_pending_until IS NULL`,
              )
              .bind(handle, args.now, args.teamId, args.actorUserId)
              .run()
      if ((result.meta.changes ?? 0) > 0) return handle
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/UNIQUE constraint failed: handles(?:\.handle|\.user_id|\.team_id)?/i.test(error.message)
      ) {
        throw error
      }
      const won =
        args.teamId === null
          ? await activeUserHandle(db, args.userId)
          : await activeTeamHandle(db, args.teamId)
      if (won) return won
      continue
    }
  }
  throw new ApiError('CONFLICT', 'could not allocate a unique owner handle')
}

function automaticHandle(
  label: string,
  ownerId: string,
  kind: 'user' | 'team',
  attempt: number,
): string {
  const suffixSeed = ownerId.toLowerCase().replace(/[^a-z0-9]/g, '')
  const suffix = `${suffixSeed.slice(-10) || kind}${attempt === 0 ? '' : attempt.toString(36)}`
  let base = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!/^[a-z]/.test(base)) base = `${kind}-${base}`
  if (base.length < 2) base = kind
  const maxBase = Math.max(2, 31 - suffix.length)
  base = base.slice(0, maxBase).replace(/-+$/g, '') || kind
  return `${base}-${suffix}`.slice(0, 32)
}

/**
 * Chooses an automatic Team handle before any upstream Team resources are
 * created. Handles are permanent tombstones, so released rows are occupied
 * too. The final claim still happens in the same D1 batch as Team creation;
 * this read is the fail-fast path, not the concurrency boundary.
 */
export async function chooseAvailableTeamHandle(
  db: D1Database,
  args: { label: string; teamId: string },
): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const handle = automaticHandle(args.label, args.teamId, 'team', attempt)
    const occupied = await db
      .prepare('/* handles:is-occupied */ SELECT 1 AS occupied FROM handles WHERE handle=? LIMIT 1')
      .bind(handle)
      .first<{ occupied: number }>()
    if (!occupied) return handle
  }
  throw new ApiError('CONFLICT', 'could not allocate a unique Team handle')
}

export async function assertHandleAvailable(db: D1Database, handle: string): Promise<void> {
  const occupied = await db
    .prepare('/* handles:is-occupied */ SELECT 1 AS occupied FROM handles WHERE handle=? LIMIT 1')
    .bind(handle)
    .first<{ occupied: number }>()
  if (occupied) throw new ApiError('CONFLICT', 'handle taken')
}

export async function changeTeamHandle(
  db: D1Database,
  args: { teamId: string; actorUserId: string; handle: string; now: number },
): Promise<void> {
  const current = await activeTeamHandle(db, args.teamId)
  if (current === args.handle) return

  try {
    const results = await db.batch([
      db
        .prepare(
          `/* handles:release-team */
           UPDATE handles SET released_at=?
           WHERE team_id=? AND released_at IS NULL
             AND EXISTS (
               SELECT 1
               FROM teams t
               JOIN team_memberships m ON m.team_id=t.id
               WHERE t.id=? AND t.archived_at IS NULL
                 AND t.deletion_pending_until IS NULL
                 AND m.user_id=? AND m.role='owner'
             )`,
        )
        .bind(args.now, args.teamId, args.teamId, args.actorUserId),
      db
        .prepare(
          `/* handles:claim-team */
           INSERT INTO handles
             (handle, user_id, team_id, claimed_at, released_at)
           SELECT ?,NULL,t.id,?,NULL
           FROM teams t
           JOIN team_memberships m ON m.team_id=t.id
           WHERE t.id=? AND t.archived_at IS NULL
             AND t.deletion_pending_until IS NULL
             AND m.user_id=? AND m.role='owner'`,
        )
        .bind(args.handle, args.now, args.teamId, args.actorUserId),
    ])
    if ((results[1]?.meta.changes ?? 0) === 0) throw new ApiError('FORBIDDEN')
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed: handles(?:\.handle|\.team_id)?/i.test(error.message)
    ) {
      throw new ApiError('CONFLICT', 'handle taken')
    }
    throw error
  }
}

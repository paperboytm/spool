import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { sequenceRoot } from '@spool-lab/session-kit'

import { ApiError } from '../errors'
import { requireHubUser } from './auth'
import { getHubSession, presentOids, presentTeamOids, type HubSessionRow } from './store'
import type { HeadBodyT } from './wire'

/** Env shape shared by every /api/hub/v1 function. */
export type HubEnv = {
  DB: D1Database
  SESSIONS: KVNamespace
  RATE: KVNamespace
  HUB: R2Bucket
  HUB_DEV_TOKEN?: string
  PUBLIC_BASE_URL?: string
}

/**
 * Shared validation for push and head-commit: single-writer ownership and
 * an integrity check the hub can afford without touching record bodies —
 * folding the manifest's oids must reproduce the claimed root. Returns the
 * oids this user still has to upload (records + the view object).
 */
export async function validateHead(
  db: D1Database,
  userId: string,
  sid: string,
  body: HeadBodyT,
): Promise<{
  missing: string[]
  aliasOids: string[]
  teamId: string | null
  teamRole: TeamRole | null
}> {
  const existing = await getHubSession(db, sid)
  const requestedTeamId = body.teamId ?? null
  const teamId = existing?.team_id ?? requestedTeamId

  let teamRole: TeamRole | null = null
  if (teamId) {
    teamRole = await activeTeamRole(db, teamId, userId)
    // Team admins manage disclosure and withdrawal, but never rewrite an
    // attributed author's immutable record stream.
    const mayWrite = teamRole !== null && (existing === null || existing.owner_user_id === userId)
    if (!mayWrite) throw new ApiError('NOT_FOUND')
  } else if (existing && existing.owner_user_id !== userId) {
    throw new ApiError('FORBIDDEN', 'session head belongs to another user')
  }

  // Authorize the current resource before returning any tenant-CAS detail.
  // Otherwise an authenticated outsider could distinguish a known Team-only
  // sid from an unknown sid by supplying an explicit personal expectation.
  if (body.expectedTeamId !== undefined && (existing?.team_id ?? null) !== body.expectedTeamId) {
    throw new ApiError('CONFLICT', 'session ownership changed; review the current Team target')
  }
  if (existing?.team_id && requestedTeamId && requestedTeamId !== existing.team_id) {
    throw new ApiError('CONFLICT', 'a Team-owned Session cannot move to another Team')
  }

  const root = await sequenceRoot(body.manifest)
  if (root !== body.root) {
    throw new ApiError('UNPROCESSABLE', 'manifest does not fold to root')
  }

  const wanted = [
    ...new Set([
      ...body.manifest,
      body.viewOid,
      ...(body.spoolFileOid === null ? [] : [body.spoolFileOid]),
    ]),
  ]
  if (!teamId) {
    const present = await presentOids(db, userId, wanted)
    return {
      missing: wanted.filter((oid) => !present.has(oid)),
      aliasOids: [],
      teamId: null,
      teamRole: null,
    }
  }

  const teamPresent = await presentTeamOids(db, teamId, wanted)
  const notInTeam = wanted.filter((oid) => !teamPresent.has(oid))
  // Old clients still upload through the personal object endpoint. Treat
  // those immutable objects as available and alias them into the Team index
  // at commit time, so a Team transfer does not strand future re-shares.
  const personalPresent = await presentOids(db, userId, notInTeam)
  return {
    missing: notInTeam.filter((oid) => !personalPresent.has(oid)),
    aliasOids: notInTeam.filter((oid) => personalPresent.has(oid)),
    teamId,
    teamRole,
  }
}

/**
 * One read-path gate for metadata, records, view, and .spool. Anonymous Team
 * reads are 401 so the web can preserve `next`; authenticated outsiders are
 * 404 so neither the Team nor the Session can be enumerated.
 */
export function requireReadableSession(db: D1Database, sid: string): Promise<HubSessionRow>
export function requireReadableSession(
  request: Request,
  env: HubEnv,
  sid: string,
): Promise<HubSessionRow>
export async function requireReadableSession(
  requestOrDb: Request | D1Database,
  envOrSid: HubEnv | string,
  maybeSid?: string,
): Promise<HubSessionRow> {
  const legacyInternalRead = maybeSid === undefined
  const request = legacyInternalRead ? null : (requestOrDb as Request)
  const env = legacyInternalRead ? null : (envOrSid as HubEnv)
  const db = legacyInternalRead ? (requestOrDb as D1Database) : (env as HubEnv).DB
  const sid = legacyInternalRead ? (envOrSid as string) : (maybeSid as string)
  const row = await getHubSession(db, sid)
  if (!row) throw new ApiError('NOT_FOUND')
  if (row.visibility === 'private') {
    if (!row.team_id || !request || !env) throw new ApiError('NOT_FOUND')
    const user = await requireHubUser(request, env)
    if ((await activeTeamRole(db, row.team_id, user.id)) === null) {
      throw new ApiError('NOT_FOUND')
    }
    // Only an authorized Team member may learn that a private Session once
    // existed. Anonymous callers get 401 and authenticated outsiders get the
    // same 404 as an unknown id, even after withdrawal.
    if (row.withdrawn_at !== null) {
      throw new ApiError('GONE', 'withdrawn', { withdrawnAt: row.withdrawn_at })
    }
    return row
  }
  if (row.visibility !== 'unlisted') throw new ApiError('NOT_FOUND')
  if (row.withdrawn_at !== null) {
    throw new ApiError('GONE', 'withdrawn', { withdrawnAt: row.withdrawn_at })
  }
  return row
}

export function sessionContentCacheControl(session: HubSessionRow): string {
  // Content bytes are immutable, but authorization at this URL is not: a
  // Public/Link-only Session can become Team-only. Force every reuse through
  // the membership gate; ETags still make an authorized 304 inexpensive.
  return session.visibility === 'private'
    ? 'private, no-store'
    : 'public, max-age=0, must-revalidate'
}

export function isTeamOnlySession(session: HubSessionRow): boolean {
  return session.visibility === 'private' && session.team_id !== null
}

export type TeamRole = 'owner' | 'admin' | 'member'

export async function activeTeamRole(
  db: D1Database,
  teamId: string,
  userId: string,
): Promise<TeamRole | null> {
  const row = await db
    .prepare(
      '/* hub:active-team-role */ ' +
        'SELECT m.role FROM team_memberships m JOIN teams t ON t.id=m.team_id ' +
        'WHERE m.team_id=? AND m.user_id=? AND t.archived_at IS NULL ' +
        'AND t.deletion_pending_until IS NULL',
    )
    .bind(teamId, userId)
    .first<{ role: TeamRole }>()
  return row?.role ?? null
}

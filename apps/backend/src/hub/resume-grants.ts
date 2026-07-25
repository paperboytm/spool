import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'

import { randomUrlSafe } from '../auth/pkce'
import { ApiError } from '../errors'
import { sha256Hex } from './auth'
import type { HubSessionRow } from './store'
import { SID_RE } from './wire'

const TOKEN_BYTES = 32
const TOKEN_RE = /^[0-9A-Za-z_-]{43}$/
const GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_BODY_BYTES = 256

export type ResumeLineageClaim = {
  token: string
  sourceSid: string
  sourcePosition: number
}

export type SanitizedResumeLineage = {
  lineageJson: string | null
  claim: ResumeLineageClaim | null
}

/** The proof is a one-use bearer, never durable lineage metadata. Strip it
 * before storing or returning lineage_json while preserving legacy payloads. */
export function sanitizeResumeLineageProof(lineageJson: string | null): SanitizedResumeLineage {
  if (lineageJson === null) return { lineageJson: null, claim: null }

  let value: unknown
  try {
    value = JSON.parse(lineageJson) as unknown
  } catch {
    return { lineageJson, claim: null }
  }
  if (!isObject(value)) return { lineageJson, claim: null }

  const hasProof = Object.hasOwn(value, 'proof')
  const rawProof = value['proof']
  const { proof: _proof, ...withoutProof } = value
  const sanitized = hasProof ? JSON.stringify(withoutProof) : lineageJson
  const source = value['source']
  if (
    typeof rawProof !== 'string' ||
    !TOKEN_RE.test(rawProof) ||
    !isObject(source) ||
    typeof source['sid'] !== 'string' ||
    !SID_RE.test(source['sid']) ||
    !Number.isSafeInteger(source['position']) ||
    (source['position'] as number) < 1
  ) {
    return { lineageJson: sanitized, claim: null }
  }
  return {
    lineageJson: sanitized,
    claim: {
      token: rawProof,
      sourceSid: source['sid'],
      sourcePosition: source['position'] as number,
    },
  }
}

export async function parseResumeGrantPosition(request: Request): Promise<number> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new ApiError('BAD_REQUEST', 'content-type must be application/json')
  }
  const length = request.headers.get('content-length')
  if (length !== null) {
    const parsed = Number(length)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_BODY_BYTES) {
      throw new ApiError('BAD_REQUEST', 'request body is too large')
    }
  }

  const bytes = await readBoundedBody(request, MAX_BODY_BYTES)
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new ApiError('BAD_REQUEST', 'invalid json')
  }
  if (
    !isObject(value) ||
    Object.keys(value).length !== 1 ||
    !Number.isSafeInteger(value['position']) ||
    (value['position'] as number) < 1
  ) {
    throw new ApiError('BAD_REQUEST', 'position must be a positive safe integer')
  }
  return value['position'] as number
}

export async function issueResumeGrant(
  db: D1Database,
  session: HubSessionRow,
  position: number,
  teamViewerUserId: string | null,
  now = Date.now(),
): Promise<{ version: 1; token: string }> {
  if (position > session.record_count) {
    throw new ApiError('BAD_REQUEST', 'position exceeds the Session record count')
  }

  const token = randomUrlSafe(TOKEN_BYTES)
  const tokenHash = await sha256Hex(token)
  const expiresAt = now + GRANT_TTL_MS
  const statements = [
    db
      .prepare(
        `/* hub:create-resume-grant */
         INSERT INTO hub_session_resume_grants
           (token_hash,source_sid,source_root,source_position,created_at,expires_at)
         SELECT ?,session.sid,session.root,?,?,?
         FROM hub_sessions session
         WHERE session.sid=?
           AND session.root=?
           AND session.updated_at=?
           AND session.record_count>=?
           AND session.withdrawn_at IS NULL
           AND (
             (session.visibility='unlisted' AND session.team_id IS ?)
             OR
             (
               session.visibility='private'
               AND session.team_id IS ?
               AND ? IS NOT NULL
               AND EXISTS (
                 SELECT 1
                 FROM teams team
                 JOIN team_memberships member ON member.team_id=team.id
                 WHERE team.id=session.team_id
                   AND team.archived_at IS NULL
                   AND team.deletion_pending_until IS NULL
                   AND member.user_id=?
               )
             )
           )`,
      )
      .bind(
        tokenHash,
        position,
        now,
        expiresAt,
        session.sid,
        session.root,
        session.updated_at,
        position,
        session.team_id ?? null,
        session.team_id ?? null,
        teamViewerUserId,
        teamViewerUserId,
      ),
    db
      .prepare(
        `/* hub:delete-expired-resume-grants */
         DELETE FROM hub_session_resume_grants
         WHERE expires_at<? AND claimed_child_sid IS NULL`,
      )
      .bind(now),
  ]
  const results = await db.batch(statements)
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new ApiError('NOT_FOUND')
  return { version: 1, token }
}

export async function prepareVerifiedForkClaim(
  db: D1Database,
  args: {
    claim: ResumeLineageClaim
    childSid: string
    childRoot: string
    childOwnerUserId: string
    childCreatedAt: number
    audienceTeamId: string | null
    now: number
  },
): Promise<D1PreparedStatement[]> {
  const tokenHash = await sha256Hex(args.claim.token)
  return [
    db
      .prepare(
        `/* hub:claim-verified-fork */
         INSERT OR IGNORE INTO hub_session_verified_forks
           (child_sid,source_sid,source_root,source_position,child_root,
            grant_token_hash,verified_at)
         SELECT child.sid,grant.source_sid,grant.source_root,
                grant.source_position,child.root,grant.token_hash,?
         FROM hub_session_resume_grants grant
         JOIN hub_sessions source ON source.sid=grant.source_sid
         JOIN hub_sessions child ON child.sid=?
         WHERE grant.token_hash=?
           AND grant.source_sid=?
           AND grant.source_position=?
           AND grant.expires_at>=?
           AND grant.claimed_child_sid IS NULL
           AND child.sid<>source.sid
           AND child.owner_user_id=?
           AND child.root=?
           AND child.created_at=?
           AND child.updated_at=?
           AND child.withdrawn_at IS NULL
           AND grant.source_position<=source.record_count
           AND (
             (
               ? IS NULL
               AND source.visibility='unlisted'
               AND source.withdrawn_at IS NULL
               AND EXISTS (
                 SELECT 1 FROM hub_session_discovery projection
                 WHERE projection.sid=source.sid
               )
             )
             OR
             (
               ? IS NOT NULL
               AND child.visibility='private'
               AND child.team_id=?
               AND source.team_id=?
               AND source.withdrawn_at IS NULL
             )
           )`,
      )
      .bind(
        args.now,
        args.childSid,
        tokenHash,
        args.claim.sourceSid,
        args.claim.sourcePosition,
        args.now,
        args.childOwnerUserId,
        args.childRoot,
        args.childCreatedAt,
        args.childCreatedAt,
        args.audienceTeamId,
        args.audienceTeamId,
        args.audienceTeamId,
        args.audienceTeamId,
      ),
    db
      .prepare(
        `/* hub:mark-resume-grant-claimed */
         UPDATE hub_session_resume_grants
         SET claimed_child_sid=?,claimed_child_root=?,claimed_at=?
         WHERE token_hash=?
           AND claimed_child_sid IS NULL
           AND EXISTS (
             SELECT 1 FROM hub_session_verified_forks relation
             WHERE relation.grant_token_hash=hub_session_resume_grants.token_hash
               AND relation.child_sid=?
               AND relation.child_root=?
           )`,
      )
      .bind(args.childSid, args.childRoot, args.now, tokenHash, args.childSid, args.childRoot),
  ]
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  if (request.body === null) throw new ApiError('BAD_REQUEST', 'request body is required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ApiError('BAD_REQUEST', 'request body is too large')
    }
    chunks.push(result.value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

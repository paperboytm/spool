import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import {
  isSessionGuidanceV1,
  MAX_SESSION_GUIDANCE_BYTES,
  MAX_SESSION_GUIDANCE_REPLY_RECORDS,
  MAX_SESSION_GUIDANCE_TURNS,
  type SessionGuidanceV1,
} from '@spool-lab/session-kit'

import { ApiError } from '../errors'
import type { HubSessionRow } from './store'

const encoder = new TextEncoder()

export {
  MAX_SESSION_GUIDANCE_BYTES,
  MAX_SESSION_GUIDANCE_REPLY_RECORDS,
  MAX_SESSION_GUIDANCE_TURNS,
}

/**
 * The canonical view is client-supplied and may describe up to 100k records.
 * Keep its convenience projection honest and small before copying it into D1
 * and the metadata-first response.
 */
export function validateSessionGuidanceForHead(
  guidance: SessionGuidanceV1 | undefined,
  recordCount: number,
): SessionGuidanceV1 | undefined {
  if (guidance === undefined) return undefined
  if (
    guidance.turns.length > MAX_SESSION_GUIDANCE_TURNS ||
    encoder.encode(JSON.stringify(guidance)).byteLength > MAX_SESSION_GUIDANCE_BYTES
  ) {
    throw new ApiError('UNPROCESSABLE', 'session guidance exceeds projection limits')
  }

  let replyRecordCount = 0
  for (const turn of guidance.turns) {
    if (turn.promptRecord >= recordCount) {
      throw new ApiError('UNPROCESSABLE', 'session guidance references records outside the head')
    }
    replyRecordCount += turn.replyRecords.length
    if (replyRecordCount > MAX_SESSION_GUIDANCE_REPLY_RECORDS) {
      throw new ApiError('UNPROCESSABLE', 'session guidance exceeds projection limits')
    }
    if (turn.replyRecords.some((record) => record >= recordCount)) {
      throw new ApiError('UNPROCESSABLE', 'session guidance references records outside the head')
    }
  }
  return guidance
}

/**
 * Resolve the small guidance projection for the current immutable head.
 * It is root-matched so a later re-share can never inherit stale guidance.
 * The metadata path deliberately does not open the much larger R2 view object.
 */
export async function getSessionGuidance(
  db: D1Database,
  session: HubSessionRow,
): Promise<SessionGuidanceV1 | null> {
  const row = await db
    .prepare(
      '/* hub:session-guidance */ ' +
        'SELECT guidance_json FROM hub_session_guidance WHERE sid=? AND root=?',
    )
    .bind(session.sid, session.root)
    .first<{ guidance_json: string }>()
  if (!row) return null

  let value: unknown
  try {
    value = JSON.parse(row.guidance_json) as unknown
  } catch {
    return null
  }
  return isSessionGuidanceV1(value) ? value : null
}

/**
 * Keep the projection in the same D1 transaction as a head advance. The
 * SELECT gate observes the just-written immutable head; if the authorized
 * head CAS lost, this statement becomes a no-op too.
 */
export function prepareSessionGuidanceProjection(
  db: D1Database,
  input: {
    sid: string
    ownerUserId: string
    root: string
    viewOid: string
    updatedAt: number
    guidance: SessionGuidanceV1 | undefined
  },
): D1PreparedStatement {
  const gate =
    'EXISTS (SELECT 1 FROM hub_sessions current ' +
    'WHERE current.sid=? AND current.owner_user_id=? AND current.root=? ' +
    'AND current.view_oid=? AND current.updated_at=? AND current.withdrawn_at IS NULL)'
  if (input.guidance === undefined) {
    return db
      .prepare(
        `/* hub:delete-session-guidance-projection */
         DELETE FROM hub_session_guidance
         WHERE sid=? AND ${gate}`,
      )
      .bind(input.sid, input.sid, input.ownerUserId, input.root, input.viewOid, input.updatedAt)
  }
  return db
    .prepare(
      `/* hub:upsert-session-guidance-projection */
       INSERT INTO hub_session_guidance (sid, root, guidance_json, generated_at)
       SELECT ?,?,?,?
       WHERE ${gate}
       ON CONFLICT(sid) DO UPDATE SET
         root=excluded.root,
         guidance_json=excluded.guidance_json,
         generated_at=excluded.generated_at`,
    )
    .bind(
      input.sid,
      input.root,
      JSON.stringify(input.guidance),
      input.updatedAt,
      input.sid,
      input.ownerUserId,
      input.root,
      input.viewOid,
      input.updatedAt,
    )
}

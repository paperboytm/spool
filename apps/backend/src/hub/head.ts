import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import { sequenceRoot } from '@spool-lab/session-kit'

import { ApiError } from '../errors'
import { getHubSession, presentOids, type HubSessionRow } from './store'
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
): Promise<{ missing: string[] }> {
  const existing = await getHubSession(db, sid)
  if (existing && existing.owner_user_id !== userId) {
    throw new ApiError('FORBIDDEN', 'session head belongs to another user')
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
  const present = await presentOids(db, userId, wanted)
  return { missing: wanted.filter((oid) => !present.has(oid)) }
}

/** Read-path gate: 404 unknown or private, 410 withdrawn. */
export async function requireReadableSession(db: D1Database, sid: string): Promise<HubSessionRow> {
  const row = await getHubSession(db, sid)
  if (!row) throw new ApiError('NOT_FOUND')
  if (row.withdrawn_at !== null) {
    throw new ApiError('GONE', 'withdrawn', { withdrawnAt: row.withdrawn_at })
  }
  if (row.visibility !== 'unlisted') throw new ApiError('NOT_FOUND')
  return row
}

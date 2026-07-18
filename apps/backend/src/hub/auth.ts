import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { requireUser } from '../auth/require'
import { ApiError } from '../errors'
import { getUserById, type UserRow } from '../store/d1'

// Hub auth accepts three credentials, tried in order:
//   1. a web session (cookie or session bearer) — the existing auth path;
//   2. a long-lived API token minted by POST /api/hub/v1/tokens (CLI);
//   3. HUB_DEV_TOKEN — local-dev shortcut, only honored when the env sets it.
// Token minting itself (see tokens.ts) deliberately accepts only path 1:
// a stolen API token must not be able to mint further tokens.

export type HubAuthEnv = {
  SESSIONS: KVNamespace
  DB: D1Database
  HUB_DEV_TOKEN?: string
}

const DEV_USER_ID = 'hub-dev-user'

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function requireHubUser(req: Request, env: HubAuthEnv): Promise<UserRow> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]

  if (bearer && env.HUB_DEV_TOKEN && bearer === env.HUB_DEV_TOKEN) {
    return ensureDevUser(env.DB)
  }

  if (bearer) {
    const hash = await sha256Hex(bearer)
    const row = await env.DB.prepare('SELECT user_id FROM api_tokens WHERE token_hash=?')
      .bind(hash)
      .first<{ user_id: string }>()
    if (row) {
      const user = await getUserById(env.DB, row.user_id)
      if (!user) throw new ApiError('UNAUTHENTICATED', 'user not found')
      if (user.deletion_pending_until) {
        throw new ApiError('FORBIDDEN', 'account deletion pending')
      }
      await env.DB.prepare('UPDATE api_tokens SET last_used_at=? WHERE token_hash=?')
        .bind(Date.now(), hash)
        .run()
      return user
    }
  }

  return requireUser(req, env)
}

async function ensureDevUser(db: D1Database): Promise<UserRow> {
  const existing = await getUserById(db, DEV_USER_ID)
  if (existing) return existing
  const now = Date.now()
  await db
    .prepare(
      'INSERT INTO users (id, email, name, avatar_url, created_at, last_signin_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(DEV_USER_ID, 'dev@localhost', 'Dev User', null, now, now)
    .run()
  const created = await getUserById(db, DEV_USER_ID)
  if (!created) throw new ApiError('INTERNAL', 'dev user create failed')
  return created
}

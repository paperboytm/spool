import type { D1Database } from '@cloudflare/workers-types'

import type { IdentityClaim } from '../auth/providers/types'
import { ApiError } from '../errors'

// 16 hex chars = 64 bits of randomness — collision probability is
// negligible at our user-table scale and the short id reads cleanly.
const USER_ID_HEX_CHARS = 16

export type UserRow = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: number
  last_signin_at: number
  deletion_pending_until: number | null
  deleted_at: number | null
}

/** Look up a user by their (provider, provider_sub) identity, updating
 *  their profile fields when one exists. Creates a fresh users row +
 *  user_identities link when none does. */
export async function upsertUserByIdentity(
  db: D1Database,
  claim: IdentityClaim,
): Promise<UserRow> {
  const existing = await db
    .prepare(
      'SELECT u.* FROM users u JOIN user_identities i ON i.user_id = u.id WHERE i.provider = ? AND i.provider_sub = ?',
    )
    .bind(claim.provider, claim.sub)
    .first<UserRow>()
  const now = Date.now()
  if (existing) {
    if (existing.deleted_at !== null) throw new ApiError('FORBIDDEN', 'account deleted')
    await db
      .prepare('UPDATE users SET email=?, name=?, avatar_url=?, last_signin_at=? WHERE id=?')
      .bind(claim.email, claim.name, claim.avatar_url, now, existing.id)
      .run()
    return {
      ...existing,
      email: claim.email,
      name: claim.name,
      avatar_url: claim.avatar_url,
      last_signin_at: now,
    }
  }
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, USER_ID_HEX_CHARS)
  await db
    .prepare(
      'INSERT INTO users (id, email, name, avatar_url, created_at, last_signin_at) VALUES (?,?,?,?,?,?)',
    )
    .bind(id, claim.email, claim.name, claim.avatar_url, now, now)
    .run()
  await db
    .prepare(
      'INSERT INTO user_identities (provider, provider_sub, user_id, email, linked_at) VALUES (?,?,?,?,?)',
    )
    .bind(claim.provider, claim.sub, id, claim.email, now)
    .run()
  return {
    id,
    email: claim.email,
    name: claim.name,
    avatar_url: claim.avatar_url,
    created_at: now,
    last_signin_at: now,
    deletion_pending_until: null,
    deleted_at: null,
  }
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE id=? AND deleted_at IS NULL')
    .bind(id)
    .first<UserRow>()
}

import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'

// 16 hex chars = 64 bits of randomness — collision probability is
// negligible at our user-table scale and the short id reads cleanly.
const USER_ID_HEX_CHARS = 16

export type UserRow = {
  id: string
  google_sub: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: number
  last_signin_at: number
  deletion_pending_until: number | null
  deleted_at: number | null
}

export async function upsertUserByGoogleSub(
  db: D1Database,
  sub: string,
  email: string,
  name: string | null,
  avatar: string | null,
): Promise<UserRow> {
  const existing = await db
    .prepare('SELECT * FROM users WHERE google_sub = ?')
    .bind(sub)
    .first<UserRow>()
  const now = Date.now()
  if (existing) {
    if (existing.deleted_at !== null) throw new ApiError('FORBIDDEN', 'account deleted')
    await db
      .prepare('UPDATE users SET email=?, name=?, avatar_url=?, last_signin_at=? WHERE id=?')
      .bind(email, name, avatar, now, existing.id)
      .run()
    return { ...existing, email, name, avatar_url: avatar, last_signin_at: now }
  }
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, USER_ID_HEX_CHARS)
  await db
    .prepare(
      'INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, last_signin_at) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(id, sub, email, name, avatar, now, now)
    .run()
  return {
    id,
    google_sub: sub,
    email,
    name,
    avatar_url: avatar,
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

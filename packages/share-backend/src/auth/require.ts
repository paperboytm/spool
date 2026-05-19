import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { getUserById, type UserRow } from '../store/d1'

import { COOKIE_NAME, readCookie } from './cookie'
import { loadSession } from './session'

export type RequireUserOpts = { allowPendingDeletion?: boolean }

export async function requireUser(
  req: Request,
  env: { SESSIONS: KVNamespace; DB: D1Database },
  opts: RequireUserOpts = {},
): Promise<UserRow> {
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const token = bearer ?? readCookie(req, COOKIE_NAME)
  if (!token) throw new ApiError('UNAUTHENTICATED')
  const sess = await loadSession(env.SESSIONS, token)
  if (!sess) throw new ApiError('UNAUTHENTICATED', 'session expired')
  const user = await getUserById(env.DB, sess.user_id)
  if (!user) throw new ApiError('UNAUTHENTICATED', 'user not found')
  if (user.deletion_pending_until && !opts.allowPendingDeletion) {
    throw new ApiError('FORBIDDEN', 'account deletion pending')
  }
  return user
}

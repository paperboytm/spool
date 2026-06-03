import type { KVNamespace } from '@cloudflare/workers-types'

import { randomUrlSafe } from './pkce'

// Session policy. Sliding TTL within a hard expiry cap.
export const MAX_TTL_SEC = 30 * 24 * 3600
const HARD_CAP_MS = 90 * 24 * 3600 * 1000
// 32 random bytes → 256-bit opaque token; base64url-encodes to 43 chars.
const TOKEN_BYTES = 32
// Permissive sanity check before hitting KV (real tokens are 43 chars).
const MIN_TOKEN_CHARS = 32
// Throttle KV writes on read: only refresh last_seen if the previous
// refresh is older than this.
const SLIDING_REFRESH_MS = 10 * 60 * 1000
// Floor for the sliding TTL — guards against writing an already-expired
// row when the session is within the last minute of MAX_TTL.
const MIN_REMAINING_TTL_SEC = 60

export type SessionRecord = {
  user_id: string
  created: number
  exp: number
  last_seen: number
}

export async function createSession(
  kv: KVNamespace,
  userId: string,
): Promise<{ token: string; exp: number }> {
  const token = randomUrlSafe(TOKEN_BYTES)
  const now = Date.now()
  const exp = now + MAX_TTL_SEC * 1000
  const rec: SessionRecord = { user_id: userId, created: now, exp, last_seen: now }
  await kv.put(`session/${token}`, JSON.stringify(rec), { expirationTtl: MAX_TTL_SEC })
  return { token, exp }
}

export async function loadSession(
  kv: KVNamespace,
  token: string,
): Promise<SessionRecord | null> {
  if (!token || token.length < MIN_TOKEN_CHARS) return null
  const v = await kv.get(`session/${token}`)
  if (!v) return null
  const rec = JSON.parse(v) as SessionRecord
  const now = Date.now()
  if (now - rec.created > HARD_CAP_MS) {
    await kv.delete(`session/${token}`)
    return null
  }
  if (now - rec.last_seen > SLIDING_REFRESH_MS) {
    rec.last_seen = now
    const ttlRemain = Math.max(
      MIN_REMAINING_TTL_SEC,
      Math.floor((rec.exp - now) / 1000),
    )
    await kv.put(`session/${token}`, JSON.stringify(rec), { expirationTtl: ttlRemain })
  }
  return rec
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session/${token}`)
}

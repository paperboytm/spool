import type { KVNamespace } from '@cloudflare/workers-types'

import { randomUrlSafe } from './pkce'

const MAX_TTL_SEC = 30 * 24 * 3600
const HARD_CAP_MS = 90 * 24 * 3600 * 1000

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
  const token = randomUrlSafe(32)
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
  if (!token || token.length < 32) return null
  const v = await kv.get(`session/${token}`)
  if (!v) return null
  const rec = JSON.parse(v) as SessionRecord
  const now = Date.now()
  if (now - rec.created > HARD_CAP_MS) {
    await kv.delete(`session/${token}`)
    return null
  }
  if (now - rec.last_seen > 600_000) {
    rec.last_seen = now
    const ttlRemain = Math.max(60, Math.floor((rec.exp - now) / 1000))
    await kv.put(`session/${token}`, JSON.stringify(rec), { expirationTtl: ttlRemain })
  }
  return rec
}

export async function destroySession(kv: KVNamespace, token: string): Promise<void> {
  await kv.delete(`session/${token}`)
}

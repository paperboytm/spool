import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { base64urlFromBuffer, sha256 } from './auth/pkce'
import { clientIp } from './request'

// 128-bit per-day salt — way beyond brute-forceable in the audit-log
// timeframe.
const SALT_BYTES = 16
// 2 days so yesterday's salt is still resolvable when a request straddles
// the UTC date boundary (correlation across the seam still works).
const SALT_TTL_SEC = 2 * 86400
// ISO 8601 date prefix length: "YYYY-MM-DD" = 10 chars.
const ISO_DATE_LEN = 10

let saltCache: { date: string; salt: string } | null = null

async function dailySalt(kv: KVNamespace): Promise<string> {
  const date = new Date().toISOString().slice(0, ISO_DATE_LEN)
  if (saltCache && saltCache.date === date) return saltCache.salt
  const k = `audit-salt/${date}`
  let salt = await kv.get(k)
  if (!salt) {
    const arr = new Uint8Array(SALT_BYTES)
    crypto.getRandomValues(arr)
    salt = base64urlFromBuffer(arr.buffer)
    await kv.put(k, salt, { expirationTtl: SALT_TTL_SEC })
  }
  saltCache = { date, salt }
  return salt
}

export function _resetSaltCacheForTests(): void {
  saltCache = null
}

export async function hashWithDailySalt(kv: KVNamespace, value: string): Promise<string> {
  const salt = await dailySalt(kv)
  return base64urlFromBuffer(await sha256(`${salt}|${value}`))
}

export async function audit(
  db: D1Database,
  kv: KVNamespace,
  req: Request,
  args: {
    user_id?: string | null
    action: string
    target_id?: string | null
    details?: object
  },
): Promise<void> {
  const ua = req.headers.get('User-Agent') ?? '-'
  const [ip_hash, ua_hash] = await Promise.all([
    hashWithDailySalt(kv, clientIp(req)),
    hashWithDailySalt(kv, ua),
  ])
  await db
    .prepare(
      'INSERT INTO audit_log (user_id, ip_hash, ua_hash, action, target_id, details_json, ts) VALUES (?,?,?,?,?,?,?)',
    )
    .bind(
      args.user_id ?? null,
      ip_hash,
      ua_hash,
      args.action,
      args.target_id ?? null,
      args.details ? JSON.stringify(args.details) : null,
      Date.now(),
    )
    .run()
}

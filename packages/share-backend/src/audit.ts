import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { base64urlFromBuffer, sha256 } from './auth/pkce'
import { clientIp } from './request'

let saltCache: { date: string; salt: string } | null = null

async function dailySalt(kv: KVNamespace): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  if (saltCache && saltCache.date === date) return saltCache.salt
  const k = `audit-salt/${date}`
  let salt = await kv.get(k)
  if (!salt) {
    const arr = new Uint8Array(16)
    crypto.getRandomValues(arr)
    salt = base64urlFromBuffer(arr.buffer)
    await kv.put(k, salt, { expirationTtl: 86400 * 2 })
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

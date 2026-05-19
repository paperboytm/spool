import type { KVNamespace } from '@cloudflare/workers-types'

export type RateKey = { bucket: string; key: string; windowSec: number; max: number }

export async function checkRate(
  kv: KVNamespace,
  r: RateKey,
): Promise<{ ok: boolean; remaining: number }> {
  const k = `rate/${r.bucket}/${r.key}`
  const now = Math.floor(Date.now() / 1000)
  const slot = Math.floor(now / r.windowSec)
  const slotKey = `${k}/${slot}`
  const cur = parseInt((await kv.get(slotKey)) ?? '0', 10)
  if (cur >= r.max) return { ok: false, remaining: 0 }
  await kv.put(slotKey, String(cur + 1), { expirationTtl: r.windowSec * 2 })
  return { ok: true, remaining: r.max - cur - 1 }
}

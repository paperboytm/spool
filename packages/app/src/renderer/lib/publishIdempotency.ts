import type { Snapshot, Visibility } from '../../shared/share-publish.js'

/**
 * Derive a deterministic idempotency token for a publish intent. Same
 * inputs ⇒ same key ⇒ the backend short-circuits a retry to the prior
 * result rather than creating a duplicate share. Any user-visible
 * change to the payload (snapshot content, visibility, expiry) shifts
 * the hash and the backend treats the next call as a fresh publish.
 *
 * The hash is sha256(JSON), encoded as lowercase hex (64 chars). We
 * stringify with a stable field order so two JS objects that are
 * structurally equal but iterate in a different order still produce
 * the same key — `crypto.subtle.digest` hashes the byte exactly so
 * key ordering matters.
 *
 * Runs on the renderer side; needs `crypto.subtle` (always available
 * in Electron 34+ and modern browsers).
 */
export async function computePublishIdempotencyKey(args: {
  snapshot: Snapshot
  visibility: Visibility
  /** ISO 8601 string when set, otherwise `null`. We normalise undefined → null
   *  so "user picked Never" and "user picked nothing" hash to the same key. */
  expires_at?: string | null
}): Promise<string> {
  const canonical = stableStringify({
    snapshot: args.snapshot,
    visibility: args.visibility,
    expires_at: args.expires_at ?? null,
  })
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Stable JSON.stringify that sorts object keys recursively. Without
 * this, two payloads that are structurally equal but were assembled
 * with a different key order would hash to different keys and the
 * idempotency guarantee would be silently broken.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== 'object') return value
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeys(obj[key])
  }
  return sorted
}

import type { D1Database } from '@cloudflare/workers-types'

import { sha256Hex } from './auth'

// Long-lived CLI (sph_) API-token minting, shared by POST
// /api/hub/v1/tokens and the cli-auth approval flow. The token value
// exists in plaintext exactly once — in the return value; only its
// sha256 lands in D1.

export async function mintApiToken(
  db: D1Database,
  userId: string,
  label: string | null,
): Promise<{ id: string; token: string }> {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const token = 'sph_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  const id = crypto.randomUUID()
  await db
    .prepare(
      'INSERT INTO api_tokens (id, user_id, token_hash, label, created_at) VALUES (?,?,?,?,?)',
    )
    .bind(id, userId, await sha256Hex(token), label, Date.now())
    .run()
  return { id, token }
}

// Shared daily cap across both minting surfaces — a single bucket so a
// user can't stack 10 web-minted + 10 cli-approved tokens per day.
export const TOKEN_MINT_RATE = { bucket: 'hub-token-d', windowSec: 86400, max: 10 }

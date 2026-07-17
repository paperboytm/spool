// CLI-auth broker state. Self-hosted device-authorization flow (RFC
// 8628 shape, our own storage): `spool login` creates a request, the
// user approves it in a signed-in browser tab, the CLI polls until the
// approval carries a freshly minted sph_ API token.
//
// Two codes per request, deliberately separate:
//   - device_code: 256-bit secret, held only by the CLI, used to poll.
//   - user_code:   short human-readable code shown in the browser URL
//                  and the terminal so the user can match them up.
// The URL never carries the device_code, so browser history can't leak
// a pollable credential.
//
// Records live in the NONCE namespace — same category of short-lived,
// single-use auth artifacts as the desktop sign-in nonces.

import type { KVNamespace } from '@cloudflare/workers-types'

import { randomUrlSafe } from './auth/pkce'

export const CLI_AUTH_TTL_SEC = 15 * 60
export const CLI_AUTH_POLL_INTERVAL_SEC = 3
// 256-bit polling secret, same strength as a session token.
const DEVICE_CODE_BYTES = 32
// user_code alphabet drops lookalikes (0/O, 1/I/L, A/4, E/3, U/V...).
// 8 chars of 28 ≈ 38 bits — plenty for a code that lives 15 minutes,
// is rate-limited on lookup, and grants nothing without an approval
// click from an authenticated session.
const USER_CODE_ALPHABET = 'BCDFGHJKMNPQRSTWXZ23456789'
const USER_CODE_CHARS = 8

export type CliAuthRecord = {
  status: 'pending' | 'approved'
  user_code: string
  label: string | null
  created: number
  /** Present only while status === 'approved' and not yet claimed. */
  token?: string
}

const codeKey = (deviceCode: string) => `cliauth/${deviceCode}`
const userCodeKey = (userCode: string) => `cliauth-uc/${userCode}`

export function formatUserCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4)}`
}

/** Uppercases and strips separators so "xkcd-2941" and "XKCD 2941"
 *  both resolve. Returns null when the residue isn't a plausible code. */
export function normalizeUserCode(raw: string): string | null {
  const bare = raw.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (bare.length !== USER_CODE_CHARS) return null
  return formatUserCode(bare)
}

function randomUserCode(): string {
  const bytes = new Uint8Array(USER_CODE_CHARS)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const b of bytes) out += USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]
  return formatUserCode(out)
}

export async function createCliAuthRequest(
  kv: KVNamespace,
  label: string | null,
): Promise<{ deviceCode: string; userCode: string }> {
  const deviceCode = randomUrlSafe(DEVICE_CODE_BYTES)
  // Regenerate on user_code collision. At 38 bits a clash among the
  // handful of concurrently-pending requests is already vanishingly
  // rare; the loop makes it impossible rather than merely unlikely.
  let userCode = randomUserCode()
  while (await kv.get(userCodeKey(userCode))) userCode = randomUserCode()

  const record: CliAuthRecord = {
    status: 'pending',
    user_code: userCode,
    label,
    created: Date.now(),
  }
  await kv.put(codeKey(deviceCode), JSON.stringify(record), {
    expirationTtl: CLI_AUTH_TTL_SEC,
  })
  await kv.put(userCodeKey(userCode), deviceCode, {
    expirationTtl: CLI_AUTH_TTL_SEC,
  })
  return { deviceCode, userCode }
}

export async function getCliAuthByDeviceCode(
  kv: KVNamespace,
  deviceCode: string,
): Promise<CliAuthRecord | null> {
  const raw = await kv.get(codeKey(deviceCode))
  return raw ? (JSON.parse(raw) as CliAuthRecord) : null
}

export async function getCliAuthByUserCode(
  kv: KVNamespace,
  userCode: string,
): Promise<{ deviceCode: string; record: CliAuthRecord } | null> {
  const deviceCode = await kv.get(userCodeKey(userCode))
  if (!deviceCode) return null
  const record = await getCliAuthByDeviceCode(kv, deviceCode)
  return record ? { deviceCode, record } : null
}

/** Attach the minted token and drop the user_code index so the same
 *  code can't be approved twice. */
export async function approveCliAuth(
  kv: KVNamespace,
  deviceCode: string,
  record: CliAuthRecord,
  token: string,
): Promise<void> {
  const next: CliAuthRecord = { ...record, status: 'approved', token }
  await kv.put(codeKey(deviceCode), JSON.stringify(next), {
    expirationTtl: CLI_AUTH_TTL_SEC,
  })
  await kv.delete(userCodeKey(record.user_code))
}

export async function denyCliAuth(
  kv: KVNamespace,
  deviceCode: string,
  record: CliAuthRecord,
): Promise<void> {
  await kv.delete(codeKey(deviceCode))
  await kv.delete(userCodeKey(record.user_code))
}

/** Single claim: the approved record is deleted in the same call that
 *  hands the token out, so a replayed poll gets NOT_FOUND. */
export async function claimCliAuth(
  kv: KVNamespace,
  deviceCode: string,
  record: CliAuthRecord,
): Promise<string | null> {
  if (record.status !== 'approved' || !record.token) return null
  await kv.delete(codeKey(deviceCode))
  return record.token
}

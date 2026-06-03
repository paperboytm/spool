const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'
const ALLOWED_ISS = new Set(['https://accounts.google.com', 'accounts.google.com'])
// Google rotates JWKS infrequently; one hour balances freshness against
// per-request fetch cost.
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000

export type Jwk = {
  kid: string
  kty: string
  alg: string
  n: string
  e: string
  use?: string
}

let cache: { keys: Jwk[]; fetchedAt: number } | null = null

export function _resetJwksCacheForTests(): void {
  cache = null
}

async function defaultFetchJwks(): Promise<Jwk[]> {
  if (cache && Date.now() - cache.fetchedAt < JWKS_CACHE_TTL_MS) return cache.keys
  const r = await fetch(JWKS_URI)
  if (!r.ok) throw new Error(`jwks fetch ${r.status}`)
  const body = (await r.json()) as { keys: Jwk[] }
  cache = { keys: body.keys, fetchedAt: Date.now() }
  return body.keys
}

let jwksFetcher: () => Promise<Jwk[]> = defaultFetchJwks

export function setJwksFetcherForTests(fn: (() => Promise<Jwk[]>) | null): void {
  jwksFetcher = fn ?? defaultFetchJwks
}

export async function fetchJwks(): Promise<Jwk[]> {
  return jwksFetcher()
}

function b64urlToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

function b64urlDecodeJson<T>(s: string): T {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/')
  return JSON.parse(atob(b64)) as T
}

async function importKey(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

export type IdTokenClaims = {
  iss: string
  aud: string
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  exp: number
  iat: number
  nonce?: string
}

export type VerifyOpts = { audience: string; nonce?: string; now?: number }

export async function verifyIdTokenWithKeys(
  idToken: string,
  keys: Jwk[],
  opts: VerifyOpts,
): Promise<IdTokenClaims> {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const [h, p, s] = parts
  if (!h || !p || !s) throw new Error('malformed token')

  let header: { alg: string; kid: string }
  try {
    header = b64urlDecodeJson<{ alg: string; kid: string }>(h)
  } catch {
    throw new Error('malformed token')
  }
  if (header.alg !== 'RS256') throw new Error('bad alg')

  const jwk = keys.find((k) => k.kid === header.kid)
  if (!jwk) throw new Error('no matching jwk')

  const key = await importKey(jwk)
  const data = new TextEncoder().encode(`${h}.${p}`)
  const sig = b64urlToBuf(s)
  const ok = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    sig,
    data,
  )
  if (!ok) throw new Error('bad signature')

  let claims: IdTokenClaims
  try {
    claims = b64urlDecodeJson<IdTokenClaims>(p)
  } catch {
    throw new Error('malformed token')
  }
  if (!ALLOWED_ISS.has(claims.iss)) throw new Error('bad iss')
  if (claims.aud !== opts.audience) throw new Error('bad aud')
  const nowSec = Math.floor((opts.now ?? Date.now()) / 1000)
  if (claims.exp <= nowSec) throw new Error('expired')
  if (opts.nonce !== undefined && claims.nonce !== opts.nonce) {
    throw new Error('bad nonce')
  }
  if (claims.email_verified === false) throw new Error('email not verified')
  return claims
}

export async function verifyIdToken(
  idToken: string,
  opts: VerifyOpts,
): Promise<IdTokenClaims> {
  const keys = await jwksFetcher()
  return verifyIdTokenWithKeys(idToken, keys, opts)
}

// Test helpers for minting JWTs against a locally generated RSA-2048 keypair.
// Uses the WebCrypto API surface that ships with Node 20+, so the same
// `crypto.subtle` calls in `src/auth/jwks.ts` verify against keys produced here.

import type { Jwk } from '../../src/auth/jwks'

export type Keypair = {
  privateKey: CryptoKey
  publicJwk: Jwk
  kid: string
}

function b64urlFromBuf(b: ArrayBuffer): string {
  const bytes = new Uint8Array(b)
  let s = ''
  for (const byte of bytes) s += String.fromCharCode(byte)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlFromString(s: string): string {
  const u8 = new TextEncoder().encode(s)
  const ab = new ArrayBuffer(u8.byteLength)
  new Uint8Array(ab).set(u8)
  return b64urlFromBuf(ab)
}

export async function generateKeypair(kid = 'test-kid-1'): Promise<Keypair> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const pubJwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
  return {
    privateKey: pair.privateKey,
    publicJwk: {
      kid,
      kty: pubJwk.kty as string,
      alg: 'RS256',
      n: pubJwk.n as string,
      e: pubJwk.e as string,
      use: 'sig',
    },
    kid,
  }
}

export type JwtPayload = {
  iss?: string
  aud?: string
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  exp?: number
  iat?: number
  nonce?: string
  [k: string]: unknown
}

export async function mintTestJwt(
  kp: Keypair,
  payload: JwtPayload,
  opts: { alg?: string; kid?: string } = {},
): Promise<string> {
  const header = { alg: opts.alg ?? 'RS256', kid: opts.kid ?? kp.kid, typ: 'JWT' }
  const h = b64urlFromString(JSON.stringify(header))
  const p = b64urlFromString(JSON.stringify(payload))
  const msg = new TextEncoder().encode(`${h}.${p}`)
  const msgBuf = new ArrayBuffer(msg.byteLength)
  new Uint8Array(msgBuf).set(msg)
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    kp.privateKey,
    msgBuf,
  )
  return `${h}.${p}.${b64urlFromBuf(sig)}`
}

/** Mints a JWT then flips the last signature byte, breaking the signature. */
export async function mintTestJwtBadSig(
  kp: Keypair,
  payload: JwtPayload,
): Promise<string> {
  const ok = await mintTestJwt(kp, payload)
  const parts = ok.split('.')
  const h = parts[0]!
  const p = parts[1]!
  const s = parts[2]!
  const decoded = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==')
  const buf = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i++) buf[i] = decoded.charCodeAt(i)
  buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff
  let bin = ''
  for (const byte of buf) bin += String.fromCharCode(byte)
  const sig = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${h}.${p}.${sig}`
}

export function future(deltaSec = 3600): number {
  return Math.floor(Date.now() / 1000) + deltaSec
}

export function past(deltaSec = 3600): number {
  return Math.floor(Date.now() / 1000) - deltaSec
}

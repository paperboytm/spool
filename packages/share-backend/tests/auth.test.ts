import { beforeAll, describe, expect, it } from 'vitest'

import {
  type Jwk,
  _resetJwksCacheForTests,
  setJwksFetcherForTests,
  verifyIdToken,
  verifyIdTokenWithKeys,
} from '../src/auth/jwks'
import {
  buildSessionCookie,
  clearCookie,
  readCookie,
} from '../src/auth/cookie'
import { pkceChallenge, randomUrlSafe } from '../src/auth/pkce'

import {
  type Keypair,
  future,
  generateKeypair,
  mintTestJwt,
  mintTestJwtBadSig,
  past,
} from './_helpers/jwt'

const AUD = 'desktop-client-id.apps.googleusercontent.com'
const ISS = 'https://accounts.google.com'

let kp: Keypair
let keys: Jwk[]

beforeAll(async () => {
  kp = await generateKeypair('kid-A')
  keys = [kp.publicJwk]
})

describe('verifyIdTokenWithKeys', () => {
  it('accepts a freshly minted valid token', async () => {
    const tok = await mintTestJwt(kp, {
      iss: ISS,
      aud: AUD,
      sub: 'g-123',
      email: 'a@example.com',
      email_verified: true,
      name: 'A',
      exp: future(600),
      iat: past(0),
      nonce: 'n1',
    })
    const claims = await verifyIdTokenWithKeys(tok, keys, { audience: AUD, nonce: 'n1' })
    expect(claims.sub).toBe('g-123')
    expect(claims.email).toBe('a@example.com')
  })

  it('rejects a malformed token (wrong segment count)', async () => {
    await expect(
      verifyIdTokenWithKeys('not.a.jwt.extra', keys, { audience: AUD }),
    ).rejects.toThrow(/malformed/)
    await expect(
      verifyIdTokenWithKeys('notajwt', keys, { audience: AUD }),
    ).rejects.toThrow(/malformed/)
  })

  it('rejects a non-RS256 alg in the header', async () => {
    const tok = await mintTestJwt(
      kp,
      { iss: ISS, aud: AUD, sub: 'x', exp: future(), iat: past(0) },
      { alg: 'HS256' },
    )
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/bad alg/)
  })

  it('rejects a wrong audience', async () => {
    const tok = await mintTestJwt(kp, {
      iss: ISS,
      aud: 'other-client',
      sub: 'x',
      exp: future(),
      iat: past(0),
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/bad aud/)
  })

  it('rejects a wrong issuer', async () => {
    const tok = await mintTestJwt(kp, {
      iss: 'https://evil.example.com',
      aud: AUD,
      sub: 'x',
      exp: future(),
      iat: past(0),
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/bad iss/)
  })

  it('rejects an expired token', async () => {
    const tok = await mintTestJwt(kp, {
      iss: ISS,
      aud: AUD,
      sub: 'x',
      exp: past(60),
      iat: past(3600),
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/expired/)
  })

  it('rejects a mismatched nonce', async () => {
    const tok = await mintTestJwt(kp, {
      iss: ISS,
      aud: AUD,
      sub: 'x',
      exp: future(),
      iat: past(0),
      nonce: 'one',
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD, nonce: 'two' }),
    ).rejects.toThrow(/nonce/)
  })

  it('rejects when no kid in JWKS matches the header', async () => {
    const tok = await mintTestJwt(
      kp,
      { iss: ISS, aud: AUD, sub: 'x', exp: future(), iat: past(0) },
      { kid: 'unknown-kid' },
    )
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/no matching jwk/)
  })

  it('rejects a token with a tampered signature', async () => {
    const tok = await mintTestJwtBadSig(kp, {
      iss: ISS,
      aud: AUD,
      sub: 'x',
      exp: future(),
      iat: past(0),
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/bad signature/)
  })

  it('rejects email_verified=false', async () => {
    const tok = await mintTestJwt(kp, {
      iss: ISS,
      aud: AUD,
      sub: 'x',
      exp: future(),
      iat: past(0),
      email_verified: false,
    })
    await expect(
      verifyIdTokenWithKeys(tok, keys, { audience: AUD }),
    ).rejects.toThrow(/email not verified/)
  })
})

describe('PKCE helpers', () => {
  it('pkceChallenge is base64url with no padding', async () => {
    const verifier = randomUrlSafe(64)
    const challenge = await pkceChallenge(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).not.toMatch(/=$/)
    // SHA-256 → 32 bytes → base64url 43 chars (no padding)
    expect(challenge.length).toBe(43)
  })

  it('randomUrlSafe(n) returns base64url charset of expected length', () => {
    for (const n of [16, 24, 32, 64]) {
      const s = randomUrlSafe(n)
      expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
      // base64url with no padding: ceil(n * 4 / 3) characters.
      expect(s.length).toBe(Math.ceil((n * 4) / 3))
    }
  })

  it('randomUrlSafe is not deterministic', () => {
    const a = randomUrlSafe(16)
    const b = randomUrlSafe(16)
    expect(a).not.toBe(b)
  })
})

describe('verifyIdToken — JWKS rotation recovery', () => {
  it('force-refreshes on "no matching jwk" and accepts a token signed by the new key', async () => {
    const oldKp = await generateKeypair('kid-old')
    const newKp = await generateKeypair('kid-new')
    let calls = 0
    setJwksFetcherForTests(async (force = false) => {
      calls++
      // First fetch (cache populate) → only the OLD key.
      // Force fetch (triggered by "no matching jwk") → only the NEW key.
      return force ? [newKp.publicJwk] : [oldKp.publicJwk]
    })
    _resetJwksCacheForTests()

    const tok = await mintTestJwt(newKp, {
      iss: ISS,
      aud: AUD,
      sub: 'g-rotated',
      email: 'r@example.com',
      email_verified: true,
      name: 'R',
      exp: future(600),
      iat: past(0),
    })
    const claims = await verifyIdToken(tok, { audience: AUD })
    expect(claims.sub).toBe('g-rotated')
    expect(calls).toBe(2) // first cached fetch, then force-refresh

    setJwksFetcherForTests(null)
    _resetJwksCacheForTests()
  })

  it('does NOT force-refresh on bad-signature errors', async () => {
    let calls = 0
    setJwksFetcherForTests(async () => {
      calls++
      return [kp.publicJwk]
    })
    _resetJwksCacheForTests()
    // Token signed by a different keypair than the JWKS returns →
    // verifyIdTokenWithKeys throws 'bad signature', not 'no matching jwk'
    // (the kid matches kp's kid but the key bytes differ on the wire).
    const other = await generateKeypair('kid-A') // same kid as kp
    const tok = await mintTestJwt(other, {
      iss: ISS,
      aud: AUD,
      sub: 'g-x',
      email_verified: true,
      exp: future(600),
      iat: past(0),
    })
    await expect(verifyIdToken(tok, { audience: AUD })).rejects.toThrow(/bad signature/)
    expect(calls).toBe(1) // no force-refresh on signature failure

    setJwksFetcherForTests(null)
    _resetJwksCacheForTests()
  })
})

describe('cookie helpers', () => {
  it('readCookie parses a single value', () => {
    const r = new Request('https://x', { headers: { cookie: 'a=1' } })
    expect(readCookie(r, 'a')).toBe('1')
  })

  it('readCookie parses multiple values and ignores whitespace', () => {
    const r = new Request('https://x', { headers: { cookie: 'a=1; b=two; c=three' } })
    expect(readCookie(r, 'b')).toBe('two')
    expect(readCookie(r, 'c')).toBe('three')
  })

  it('readCookie returns null for missing cookie', () => {
    const r = new Request('https://x', { headers: { cookie: 'a=1' } })
    expect(readCookie(r, 'missing')).toBeNull()
  })

  it('readCookie returns null when no cookie header at all', () => {
    const r = new Request('https://x')
    expect(readCookie(r, 'x')).toBeNull()
  })

  it('buildSessionCookie sets HttpOnly, Secure, SameSite=Lax, Path=/', () => {
    const c = buildSessionCookie('abc', 3600)
    expect(c).toMatch(/^spool_session=abc/)
    expect(c).toMatch(/HttpOnly/)
    expect(c).toMatch(/Secure/)
    expect(c).toMatch(/SameSite=Lax/)
    expect(c).toMatch(/Path=\//)
    expect(c).toMatch(/Max-Age=3600/)
  })

  it('clearCookie zeros the value with Max-Age=0', () => {
    const c = clearCookie('spool_session')
    expect(c).toMatch(/^spool_session=;/)
    expect(c).toMatch(/Max-Age=0/)
  })
})

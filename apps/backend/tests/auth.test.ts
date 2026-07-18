import { describe, expect, it } from 'vite-plus/test'

import { buildSessionCookie, clearCookie, readCookie } from '../src/auth/cookie'
import { pkceChallenge, randomUrlSafe } from '../src/auth/pkce'

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

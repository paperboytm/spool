import { describe, it, expect } from 'vitest'
import {
  REDACT_DETECTOR_VERSION,
  currentProfileString,
  parseProfile,
  profilesMatch,
  providersInProfile,
} from './profile.js'

describe('currentProfileString', () => {
  it('regex-only is the default', () => {
    expect(currentProfileString()).toBe(`regex@${REDACT_DETECTOR_VERSION}`)
  })
  it('explicit regex version overrides the default', () => {
    expect(currentProfileString({ regexVersion: 7 })).toBe('regex@7')
  })
  it('emits pf segment when enabled', () => {
    expect(
      currentProfileString({ pfEnabled: true, pfVersion: '1.5b-q4' }),
    ).toBe(`regex@${REDACT_DETECTOR_VERSION},pf@1.5b-q4`)
  })
  it('throws when pfEnabled without pfVersion', () => {
    expect(() => currentProfileString({ pfEnabled: true })).toThrow(/pfVersion/)
  })
})

describe('parseProfile', () => {
  it('parses regex-only', () => {
    expect(parseProfile('regex@3')).toEqual({ regex: 3 })
  })
  it('parses regex + pf', () => {
    expect(parseProfile('regex@3,pf@1.5b-q4')).toEqual({ regex: 3, pf: '1.5b-q4' })
  })
  it('rejects null / empty / whitespace', () => {
    expect(parseProfile(null)).toBeNull()
    expect(parseProfile(undefined)).toBeNull()
    expect(parseProfile('')).toBeNull()
    expect(parseProfile('   ')).toBeNull()
  })
  it('rejects malformed segments', () => {
    expect(parseProfile('regex')).toBeNull()        // no @
    expect(parseProfile('regex@')).toBeNull()       // empty version
    expect(parseProfile('@3')).toBeNull()           // empty name
    expect(parseProfile('regex@x')).toBeNull()      // non-integer
    expect(parseProfile('regex@-1')).toBeNull()     // negative
    expect(parseProfile('regex@3.5')).toBeNull()    // non-integer
  })
  it('rejects unknown provider names (forward-compat: treat as stale)', () => {
    expect(parseProfile('regex@3,wat@1')).toBeNull()
  })
  it('requires regex segment', () => {
    expect(parseProfile('pf@1.5b')).toBeNull()
  })
})

describe('profilesMatch', () => {
  it('matches identical profiles', () => {
    expect(profilesMatch('regex@3', 'regex@3')).toBe(true)
    expect(profilesMatch('regex@3,pf@1.5b', 'regex@3,pf@1.5b')).toBe(true)
  })
  it('order-insensitive — pf-then-regex matches regex-then-pf', () => {
    expect(profilesMatch('regex@3,pf@1.5b', 'pf@1.5b,regex@3')).toBe(true)
  })
  it('mismatches different regex versions', () => {
    expect(profilesMatch('regex@3', 'regex@4')).toBe(false)
  })
  it('mismatches when only one has pf', () => {
    expect(profilesMatch('regex@3', 'regex@3,pf@1.5b')).toBe(false)
  })
  it('null or stale stored profile never matches', () => {
    expect(profilesMatch(null, 'regex@3')).toBe(false)
    expect(profilesMatch('regex@3', null)).toBe(false)
    expect(profilesMatch('garbage', 'regex@3')).toBe(false)
  })
})

describe('providersInProfile', () => {
  it('regex-only profile lists ["regex"]', () => {
    expect(providersInProfile('regex@3')).toEqual(['regex'])
  })
  it('regex + pf profile lists both', () => {
    expect(providersInProfile('regex@3,pf@1.5b')).toEqual(['regex', 'pf'])
  })
  it('empty list for unparseable input', () => {
    expect(providersInProfile('garbage')).toEqual([])
  })
})

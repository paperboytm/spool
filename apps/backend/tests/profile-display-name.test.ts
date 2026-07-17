import { describe, expect, it } from 'vitest'

import {
  resolveDisplayName,
  validateDisplayName,
} from '../src/profile/display-name'

describe('validateDisplayName', () => {
  it('accepts a normal ASCII name', () => {
    const r = validateDisplayName('Alice')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('Alice')
  })

  it('accepts CJK + emoji', () => {
    const r = validateDisplayName('陈晨 🎈')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('陈晨 🎈')
  })

  it('trims surrounding whitespace', () => {
    const r = validateDisplayName('   Alice  ')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('Alice')
  })

  it('rejects empty', () => {
    const r = validateDisplayName('')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })

  it('rejects whitespace-only', () => {
    const r = validateDisplayName('     ')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('empty')
  })

  it('rejects > 50 graphemes', () => {
    // 51 distinct ASCII chars
    const long = 'a'.repeat(51)
    const r = validateDisplayName(long)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_long')
  })

  it('counts emoji as one grapheme (50 emoji is fine, 51 is not)', () => {
    const fifty = '🎉'.repeat(50)
    expect(validateDisplayName(fifty).ok).toBe(true)
    const fiftyOne = '🎉'.repeat(51)
    const r = validateDisplayName(fiftyOne)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too_long')
  })

  it('rejects names containing a zero-width space (impersonation guard)', () => {
    const r = validateDisplayName(`Alice${String.fromCharCode(0x200b)}`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('control_chars')
  })

  it('rejects names containing a newline', () => {
    const r = validateDisplayName('Alice\nLine 2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('control_chars')
  })

  it('rejects names containing a BOM in the middle', () => {
    // BOM at the end gets trimmed (modern JS treats U+FEFF as
    // whitespace), so the impersonation surface we actually care about
    // is BOM inside the value.
    const r = validateDisplayName(`Ali${String.fromCharCode(0xfeff)}ce`)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('control_chars')
  })
})

describe('resolveDisplayName', () => {
  it('prefers display_name override over provider name', () => {
    expect(resolveDisplayName({
      display_name: 'Custom',
      name: 'Provider',
      email: 'a@example.com',
    })).toBe('Custom')
  })

  it('falls through to provider name when override missing', () => {
    expect(resolveDisplayName({
      display_name: null,
      name: 'Provider',
      email: 'a@example.com',
    })).toBe('Provider')
  })

  it('falls through to email local-part when both missing', () => {
    expect(resolveDisplayName({
      display_name: null,
      name: null,
      email: 'localpart@example.com',
    })).toBe('localpart')
  })

  it('treats empty-string display_name as missing', () => {
    expect(resolveDisplayName({
      display_name: '',
      name: 'Provider',
      email: 'a@example.com',
    })).toBe('Provider')
  })
})

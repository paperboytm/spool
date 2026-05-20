import { describe, it, expect } from 'vitest'
import {
  compactModel,
  formatScanAgo,
  friendlyKind,
  isHighKind,
  isInfoKind,
} from './page-helpers.js'

describe('compactModel', () => {
  it('returns empty string for null / undefined / ""', () => {
    expect(compactModel(null)).toBe('')
    expect(compactModel(undefined)).toBe('')
    expect(compactModel('')).toBe('')
  })

  it('drops the claude- prefix and joins major.minor', () => {
    expect(compactModel('claude-sonnet-4-5')).toBe('sonnet 4.5')
    expect(compactModel('claude-opus-4-7')).toBe('opus 4.7')
    expect(compactModel('claude-haiku-3-5')).toBe('haiku 3.5')
  })

  it('passes through dated suffixes unchanged (regex anchored, not date-stripping)', () => {
    // `claude-sonnet-4-5-20251022` has three numeric segments after
    // the family; the anchored regex only accepts up to two, so the
    // whole id passes through. The parser strips dates at sync
    // time, so this should rarely surface in the UI — but if it
    // does, the user sees the raw id rather than a wrong-confidently
    // truncated label.
    expect(compactModel('claude-sonnet-4-5-20251022')).toBe('claude-sonnet-4-5-20251022')
  })

  it('handles family-only ids (no version digits)', () => {
    expect(compactModel('claude-sonnet')).toBe('sonnet')
  })

  it('handles family + major only (no minor)', () => {
    expect(compactModel('claude-opus-4')).toBe('opus 4')
  })

  it('passes through non-Claude model ids unchanged', () => {
    expect(compactModel('gpt-5.4')).toBe('gpt-5.4')
    expect(compactModel('gemini-2.5-pro')).toBe('gemini-2.5-pro')
    expect(compactModel('llama-3-70b')).toBe('llama-3-70b')
  })

  it('does not match unknown claude families (passes through)', () => {
    // Future-proofing: a new family like `claude-mega-1` should NOT
    // get mangled — we'd rather show the raw id than wrong-confidently
    // truncate it.
    expect(compactModel('claude-mega-1')).toBe('claude-mega-1')
  })
})

describe('formatScanAgo', () => {
  const NOW = new Date('2026-05-20T12:00:00Z').getTime()
  const iso = (deltaMs: number) => new Date(NOW - deltaMs).toISOString()

  it('returns "just now" for < 45 seconds', () => {
    expect(formatScanAgo(iso(0), NOW)).toBe('just now')
    expect(formatScanAgo(iso(20_000), NOW)).toBe('just now')
    expect(formatScanAgo(iso(44_000), NOW)).toBe('just now')
  })

  it('renders minutes for 45s ≤ Δ < 60min', () => {
    expect(formatScanAgo(iso(60_000), NOW)).toBe('1m ago')
    expect(formatScanAgo(iso(30 * 60_000), NOW)).toBe('30m ago')
    expect(formatScanAgo(iso(59 * 60_000), NOW)).toBe('59m ago')
  })

  it('renders hours for 60min ≤ Δ < 24h', () => {
    expect(formatScanAgo(iso(60 * 60_000), NOW)).toBe('1h ago')
    expect(formatScanAgo(iso(23 * 60 * 60_000), NOW)).toBe('23h ago')
  })

  it('renders days for Δ ≥ 24h', () => {
    expect(formatScanAgo(iso(24 * 60 * 60_000), NOW)).toBe('1d ago')
    expect(formatScanAgo(iso(7 * 24 * 60 * 60_000), NOW)).toBe('7d ago')
  })

  it('treats negative deltas (clock skew or future timestamps) as "just now"', () => {
    expect(formatScanAgo(iso(-60_000), NOW)).toBe('just now')
  })

  it('returns "just now" for unparseable input (new Date(bad) yields NaN, not throw)', () => {
    // The catch branch returning "" only fires on real exceptions
    // (e.g. mutated Date constructor). Strings that just fail to
    // parse become NaN getTime, which falls through to the
    // `!Number.isFinite(ms)` guard returning "just now". This is
    // deliberately conservative — better to under-report than show
    // garbage timestamps.
    expect(formatScanAgo('not a date', NOW)).toBe('just now')
  })
})

describe('isHighKind / isInfoKind', () => {
  it('classifies credential-tier kinds as high', () => {
    for (const k of ['api-key', 'private-key', 'jwt', 'bearer', 'env-var', 'connection-string']) {
      expect(isHighKind(k), `${k} should be high`).toBe(true)
      expect(isInfoKind(k), `${k} should not be info`).toBe(false)
    }
  })

  it('classifies infra signals as info', () => {
    for (const k of ['absolute-path', 'ip', 'internal-host']) {
      expect(isInfoKind(k), `${k} should be info`).toBe(true)
      expect(isHighKind(k), `${k} should not be high`).toBe(false)
    }
  })

  it('classifies identity-tier kinds as neither (low by elimination)', () => {
    for (const k of ['email', 'phone', 'person-name', 'street-address', 'credit-card', 'ssn', 'date-of-birth']) {
      expect(isHighKind(k), `${k} should not be high`).toBe(false)
      expect(isInfoKind(k), `${k} should not be info`).toBe(false)
    }
  })

  it('returns false for unknown kinds (no accidental tier assignment)', () => {
    expect(isHighKind('made-up-kind')).toBe(false)
    expect(isInfoKind('made-up-kind')).toBe(false)
  })
})

describe('friendlyKind', () => {
  it('maps known kinds to human-readable labels', () => {
    expect(friendlyKind('api-key')).toBe('API key')
    expect(friendlyKind('private-key')).toBe('private key')
    expect(friendlyKind('jwt')).toBe('JWT')
    expect(friendlyKind('ssn')).toBe('SSN')
    expect(friendlyKind('date-of-birth')).toBe('DOB')
    expect(friendlyKind('absolute-path')).toBe('absolute path')
  })

  it('passes unknown kinds through unchanged (forward-compat)', () => {
    expect(friendlyKind('some-future-kind')).toBe('some-future-kind')
    expect(friendlyKind('')).toBe('')
  })
})

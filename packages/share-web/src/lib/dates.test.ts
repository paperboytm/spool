import { describe, expect, it } from 'vitest'

import { humanDate, humanDateTime, relativeDate } from './dates'

describe('humanDate', () => {
  it('formats a valid timestamp as Mon DD, YYYY', () => {
    // 2026-06-04 12:00 UTC — toLocaleDateString uses the host timezone,
    // so we accept any "Jun" date in the same week to avoid TZ flake.
    const ts = Date.UTC(2026, 5, 4, 12, 0, 0)
    expect(humanDate(ts)).toMatch(/^Jun \d, 2026$/)
  })

  it('returns "" for NaN — guards against Invalid Date leaking to UI', () => {
    expect(humanDate(Number.NaN)).toBe('')
  })

  it('returns "" for Infinity', () => {
    expect(humanDate(Number.POSITIVE_INFINITY)).toBe('')
    expect(humanDate(Number.NEGATIVE_INFINITY)).toBe('')
  })
})

describe('humanDateTime', () => {
  it('returns "" for NaN', () => {
    expect(humanDateTime(Number.NaN)).toBe('')
  })

  it('emits a Jun date + time for a valid timestamp', () => {
    const ts = Date.UTC(2026, 5, 4, 12, 0, 0)
    // Substring-match: TZ varies, but "Jun" and "2026" must appear.
    const out = humanDateTime(ts)
    expect(out).toMatch(/Jun.*2026/)
  })
})

describe('relativeDate', () => {
  // Pin "now" so the test doesn't drift with the wall clock.
  const now = Date.UTC(2026, 5, 8, 10, 0, 0) // 2026-06-08 10:00 UTC

  it('returns "Just now" for diffs under one minute', () => {
    expect(relativeDate(now - 30_000, now)).toBe('Just now')
  })

  it('returns "Today" for timestamps earlier the same calendar day', () => {
    expect(relativeDate(now - 5 * 3600 * 1000, now)).toBe('Today')
  })

  it('returns "Yesterday" for one calendar day back', () => {
    const yesterday = now - 24 * 3600 * 1000
    expect(relativeDate(yesterday, now)).toBe('Yesterday')
  })

  it('returns "Nd ago" for 2–6 days back', () => {
    const threeDaysBack = now - 3 * 24 * 3600 * 1000
    expect(relativeDate(threeDaysBack, now)).toBe('3d ago')
  })

  it('falls through to humanDate at 7+ days back', () => {
    const eightDaysBack = now - 8 * 24 * 3600 * 1000
    expect(relativeDate(eightDaysBack, now)).toMatch(/2026/)
  })

  it('returns "Today" / "Just now" for future timestamps (does not crash)', () => {
    // We deliberately tolerate slight clock drift rather than throwing.
    const oneSecondFromNow = now + 1000
    const out = relativeDate(oneSecondFromNow, now)
    expect(out === 'Just now' || out === 'Today').toBe(true)
  })

  it('returns "" for NaN input', () => {
    expect(relativeDate(Number.NaN, now)).toBe('')
  })
})

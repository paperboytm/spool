import { describe, expect, it } from 'vitest'

import { normalizeTabTitle } from './page-title'

describe('normalizeTabTitle', () => {
  it('passes a normal title through unchanged', () => {
    expect(normalizeTabTitle('My great chat')).toBe('My great chat')
  })

  it('strips control characters and collapses whitespace', () => {
    expect(normalizeTabTitle('a\n\tb   cd')).toBe('a b cd')
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTabTitle('  spaced  ')).toBe('spaced')
  })

  it('bounds the length of a pathological title', () => {
    const out = normalizeTabTitle('x'.repeat(500))
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('…')).toBe(true)
  })
})

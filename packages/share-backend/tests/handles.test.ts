import { describe, expect, it } from 'vitest'

import { validateHandle } from '../src/handles'

describe('validateHandle', () => {
  it.each([
    ['chen'],
    ['chen-2'],
    ['a_b'],
    ['abc'],
    ['user_name'],
    ['a1b2c3'],
    ['a'.repeat(32)],
  ])('accepts %s', (h) => {
    const r = validateHandle(h)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.handle).toBe(h)
  })

  it('lowercases mixed-case input', () => {
    const r = validateHandle('Chen-2')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.handle).toBe('chen-2')
  })

  it.each([
    ['', 'empty'],
    ['ab', 'too short'],
    ['a'.repeat(33), 'too long'],
    ['2chen', 'leading digit'],
    ['-chen', 'leading dash'],
    ['_chen', 'leading underscore'],
    ['ch en', 'space'],
    ['ch.en', 'dot'],
    ['ch!en', 'bang'],
  ])('rejects %s (%s)', (h) => {
    const r = validateHandle(h)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid format')
  })

  it.each(['admin', 'support', 'spool', 'api', 'help', 'editor'])(
    'rejects reserved %s',
    (h) => {
      const r = validateHandle(h)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('reserved')
    },
  )

  it('rejects non-strings', () => {
    expect(validateHandle(undefined).ok).toBe(false)
    expect(validateHandle(123).ok).toBe(false)
    expect(validateHandle(null).ok).toBe(false)
    expect(validateHandle({}).ok).toBe(false)
  })
})

import { describe, it, expect } from 'vitest'
import { compactModel, friendlyMaskName } from './format.js'

describe('compactModel', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(compactModel(null)).toBe('')
    expect(compactModel(undefined)).toBe('')
    expect(compactModel('')).toBe('')
  })

  it('strips claude- prefix and joins major.minor with dot', () => {
    expect(compactModel('claude-sonnet-4-5')).toBe('sonnet 4.5')
    expect(compactModel('claude-opus-4-7')).toBe('opus 4.7')
    expect(compactModel('claude-haiku-3-5')).toBe('haiku 3.5')
  })

  it('handles major-only forms', () => {
    expect(compactModel('claude-opus-4')).toBe('opus 4')
  })

  it('handles bare name with no version', () => {
    expect(compactModel('claude-sonnet')).toBe('sonnet')
  })

  it('returns the raw string when input does not match the pattern', () => {
    expect(compactModel('gpt-4o')).toBe('gpt-4o')
    expect(compactModel('llama3')).toBe('llama3')
    // Date-suffixed form (e.g. claude-sonnet-4-5-20251022) has three
    // numeric trailers and falls through unchanged.
    expect(compactModel('claude-sonnet-4-5-20251022')).toBe('claude-sonnet-4-5-20251022')
  })
})

describe('friendlyMaskName', () => {
  it('maps known SensitiveKind values to their human label', () => {
    expect(friendlyMaskName('api-key')).toBe('API key')
    expect(friendlyMaskName('jwt')).toBe('JWT')
    expect(friendlyMaskName('credit-card')).toBe('Credit card')
    expect(friendlyMaskName('person-name')).toBe('Person name')
    expect(friendlyMaskName('absolute-path')).toBe('Absolute path')
  })

  it('falls back to the raw kind when the label table has no entry', () => {
    expect(friendlyMaskName('unknown-future-kind')).toBe('unknown-future-kind')
    expect(friendlyMaskName('')).toBe('')
  })
})

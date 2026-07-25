import { describe, expect, it } from 'vite-plus/test'

import { normalizeSessionLanguage } from './language'

describe('normalizeSessionLanguage', () => {
  it('maps English and Chinese locale variants to supported Session languages', () => {
    expect(normalizeSessionLanguage('en')).toBe('en')
    expect(normalizeSessionLanguage('en-US')).toBe('en')
    expect(normalizeSessionLanguage('zh-CN')).toBe('zh')
    expect(normalizeSessionLanguage('zh-Hant')).toBe('zh')
  })

  it('does not invent a preference for unsupported or empty locales', () => {
    expect(normalizeSessionLanguage('de-DE')).toBeNull()
    expect(normalizeSessionLanguage('')).toBeNull()
    expect(normalizeSessionLanguage(null)).toBeNull()
  })
})

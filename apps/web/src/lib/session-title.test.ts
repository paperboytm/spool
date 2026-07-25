import { describe, expect, it } from 'vite-plus/test'

import {
  formatSessionCost,
  pickLocalizedSummary,
  pickLocalizedTitle,
  resolveLocalizedSessionSummary,
  resolveLocalizedTitle,
} from './session-title'

const TITLES = { en: 'Fix refresh-token race across tabs', zh: '修复跨标签页刷新令牌竞态' }

describe('pickLocalizedTitle', () => {
  it('prefers the locale title and falls back sensibly', () => {
    expect(pickLocalizedTitle(TITLES, 'fallback', 'zh-CN')).toBe(TITLES.zh)
    expect(pickLocalizedTitle(TITLES, 'fallback', 'zh-TW')).toBe(TITLES.zh)
    expect(pickLocalizedTitle(TITLES, 'fallback', 'en-US')).toBe(TITLES.en)
    expect(pickLocalizedTitle(TITLES, 'fallback', 'de')).toBe(TITLES.en)
    expect(pickLocalizedTitle({ en: TITLES.en }, 'fallback', 'zh-CN')).toBe(TITLES.en)
    expect(pickLocalizedTitle({ zh: TITLES.zh }, 'fallback', 'en-US')).toBe(TITLES.zh)
    expect(pickLocalizedTitle(null, 'fallback', 'zh-CN')).toBe('fallback')
    expect(pickLocalizedTitle({ en: '   ' }, 'fallback', 'en-US')).toBe('fallback')
  })

  it('defaults to English when no navigator locale exists (SSR)', () => {
    // vitest node environment has no navigator; must not throw.
    expect(pickLocalizedTitle(TITLES, 'fallback')).toBe(TITLES.en)
  })

  it('reports the language actually rendered when a translation is missing', () => {
    expect(resolveLocalizedTitle({ zh: TITLES.zh }, 'fallback', 'en')).toEqual({
      text: TITLES.zh,
      language: 'zh',
    })
    expect(resolveLocalizedTitle(null, 'legacy title', 'zh')).toEqual({
      text: 'legacy title',
      language: null,
    })
  })
})

describe('formatSessionCost', () => {
  it('formats dollars and compact token counts', () => {
    expect(formatSessionCost({ usd: 1.87, totalTokens: 2_400_000 })).toBe('$1.87 · 2.4M tokens')
    expect(formatSessionCost({ usd: 0.004, totalTokens: 900 })).toBe('<$0.01 · 900 tokens')
    expect(formatSessionCost({ usd: 0, totalTokens: 500 })).toBe('$0.00 · 500 tokens')
    expect(formatSessionCost({ usd: null, totalTokens: 1_200 })).toBe('1.2K tokens')
  })

  it('renders nothing for legacy sessions without recorded usage', () => {
    expect(formatSessionCost(null)).toBeNull()
    expect(formatSessionCost(undefined)).toBeNull()
    expect(formatSessionCost({ usd: 3, totalTokens: 0 })).toBeNull()
  })
})

describe('pickLocalizedSummary', () => {
  const summaries = {
    en: 'Background and outcome in English.',
    zh: '中文背景、动机和结果。',
  }

  it('keeps titles and summaries on the same browser locale', () => {
    expect(pickLocalizedSummary(summaries, 'legacy', 'zh-CN')).toBe('中文背景、动机和结果。')
    expect(pickLocalizedSummary(summaries, 'legacy', 'en-US')).toBe(
      'Background and outcome in English.',
    )
  })

  it('falls back across locales, then to a legacy body', () => {
    expect(pickLocalizedSummary({ en: 'English only' }, 'legacy', 'zh-TW')).toBe('English only')
    expect(pickLocalizedSummary(null, 'legacy', 'zh-CN')).toBe('legacy')
    expect(pickLocalizedSummary(null, null, 'en')).toBeNull()
    expect(resolveLocalizedSessionSummary({ en: 'English only' }, null, 'zh')).toEqual({
      text: 'English only',
      language: 'en',
    })
  })
})

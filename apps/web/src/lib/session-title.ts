import type { SessionSummaries, SessionTitles } from '@spool-lab/session-kit'

import type { SessionLanguage } from './language'

export interface LocalizedSessionText {
  text: string | null
  language: SessionLanguage | null
}

export function resolveLocalizedTitle(
  titles: SessionTitles | null | undefined,
  fallback: string,
  locale: SessionLanguage,
): LocalizedSessionText {
  const en = cleanValue(titles?.en)
  const zh = cleanValue(titles?.zh)
  if (locale === 'zh') {
    if (zh) return { text: zh, language: 'zh' }
    if (en) return { text: en, language: 'en' }
  } else {
    if (en) return { text: en, language: 'en' }
    if (zh) return { text: zh, language: 'zh' }
  }
  return { text: fallback, language: null }
}

/**
 * Titles are stored bilingually (en + zh); readers get the one matching
 * their selected Session language. A missing translation falls back to the
 * other stored language before the legacy derived title.
 */
export function pickLocalizedTitle(
  titles: SessionTitles | null | undefined,
  fallback: string,
  locale?: string,
): string {
  return resolveLocalizedTitle(
    titles,
    fallback,
    locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en',
  ).text!
}

/** Select the Summary body with the same locale and fallback contract as titles. */
export function pickLocalizedSummary(
  summaries: SessionSummaries | null | undefined,
  fallback: string | null | undefined,
  locale?: string,
): string | null {
  return resolveLocalizedSessionSummary(
    summaries,
    fallback,
    locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en',
  ).text
}

export function resolveLocalizedSessionSummary(
  summaries: SessionSummaries | null | undefined,
  fallback: string | null | undefined,
  locale: SessionLanguage,
): LocalizedSessionText {
  const en = cleanValue(summaries?.en)
  const zh = cleanValue(summaries?.zh)
  if (locale === 'zh') {
    if (zh) return { text: zh, language: 'zh' }
    if (en) return { text: en, language: 'en' }
  } else {
    if (en) return { text: en, language: 'en' }
    if (zh) return { text: zh, language: 'zh' }
  }
  return { text: cleanValue(fallback ?? undefined) ?? null, language: null }
}

function cleanValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export interface SessionCostSummary {
  usd: number | null
  totalTokens: number
}

/**
 * Quiet mono evidence next to publication facts: `$1.87 · 2.4M tokens`.
 * Null when there is nothing recorded — legacy Sessions render unchanged.
 */
export function formatSessionCost(cost: SessionCostSummary | null | undefined): string | null {
  if (!cost || !Number.isFinite(cost.totalTokens) || cost.totalTokens <= 0) return null
  const tokens = `${compactNumber(cost.totalTokens)} tokens`
  if (cost.usd === null || !Number.isFinite(cost.usd)) return tokens
  if (cost.usd > 0 && cost.usd < 0.01) return `<$0.01 · ${tokens}`
  return `$${cost.usd.toFixed(2)} · ${tokens}`
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  )
}

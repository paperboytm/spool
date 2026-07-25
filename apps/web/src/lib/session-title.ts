import type { SessionSummaries, SessionTitles } from '@spool-lab/session-kit'
import { useSyncExternalStore } from 'react'

const getServerLocale = () => 'en'
const getBrowserLocale = () =>
  typeof navigator === 'undefined' ? getServerLocale() : navigator.language || 'en'
const subscribeToLocale = (onStoreChange: () => void) => {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('languagechange', onStoreChange)
  return () => window.removeEventListener('languagechange', onStoreChange)
}

/**
 * Titles are stored bilingually (en + zh); readers get the one matching
 * their browser locale. Chinese locales prefer the zh title, everything
 * else the English one; both fall back to the legacy derived title.
 */
export function pickLocalizedTitle(
  titles: SessionTitles | null | undefined,
  fallback: string,
  locale?: string,
): string {
  const en = cleanValue(titles?.en)
  const zh = cleanValue(titles?.zh)
  const resolved = locale ?? 'en'
  const preferred = resolved.toLowerCase().startsWith('zh') ? (zh ?? en) : en
  return preferred ?? fallback
}

/**
 * Hydration-safe locale selection: SSR and the hydration pass both use
 * English, then React reconciles to the browser locale after subscribing.
 */
export function useLocalizedSessionTitle(
  titles: SessionTitles | null | undefined,
  fallback: string,
): string {
  const locale = useSyncExternalStore(subscribeToLocale, getBrowserLocale, getServerLocale)
  return pickLocalizedTitle(titles, fallback, locale)
}

/** Select the Summary body with the same locale and fallback contract as titles. */
export function pickLocalizedSummary(
  summaries: SessionSummaries | null | undefined,
  fallback: string | null | undefined,
  locale?: string,
): string | null {
  const en = cleanValue(summaries?.en)
  const zh = cleanValue(summaries?.zh)
  const legacy = cleanValue(fallback ?? undefined)
  const resolved = locale ?? 'en'
  const preferred = resolved.toLowerCase().startsWith('zh') ? (zh ?? en) : (en ?? zh)
  return preferred ?? legacy ?? null
}

/** Hydration-safe locale selection for bilingual Summary bodies. */
export function useLocalizedSessionSummary(
  summaries: SessionSummaries | null | undefined,
  fallback: string | null | undefined,
): string | null {
  const locale = useSyncExternalStore(subscribeToLocale, getBrowserLocale, getServerLocale)
  return pickLocalizedSummary(summaries, fallback, locale)
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

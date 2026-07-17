/** Bucket keys used by LibraryLanding's date grouping. Pass the key (not
 *  the localized label) so this formatter can short-circuit the redundant
 *  "today, HH:MM" / "yesterday, HH:MM" prefix when the row is already
 *  rendered under a "Today" / "Yesterday" section header. */
export type BucketKey = 'today' | 'yesterday' | 'earlierWeek' | 'earlierMonth' | 'older'

type LooseT = (key: string, opts?: Record<string, unknown>) => string

/** English fallback so callers that don't pass a translator (e.g. older
 *  test fixtures, code paths still being migrated) keep producing the
 *  pre-i18n strings rather than echoing raw keys. */
const fallbackT: LooseT = (key, opts) => {
  const o = (opts ?? {}) as { time?: string; bucket?: BucketKey }
  switch (key) {
    case 'time.todayAt': return `today, ${o.time}`
    case 'time.yesterdayAt': return `yesterday, ${o.time}`
    case 'time.timeOnly': return o.time ?? ''
    default: return key
  }
}

// Intl.DateTimeFormat instantiation is expensive on CJK locales (V8 has to
// load ICU data on the main thread), and the home view calls this once per
// session row. Memoize by (locale, shape) so we pay the cost once per
// locale switch, not once per row.
const formatterCache = new Map<string, Intl.DateTimeFormat>()
export function getMonthDayFormatter(locale: string | undefined, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${withYear ? 'ymd' : 'md'}`
  let fmt = formatterCache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, withYear
      ? { month: 'short', day: 'numeric', year: 'numeric' }
      : { month: 'short', day: 'numeric' })
    formatterCache.set(key, fmt)
  }
  return fmt
}

export function formatRelativeDate(
  iso: string,
  opts?: { bucket?: BucketKey | undefined; t?: LooseT | undefined },
): string {
  const t = opts?.t ?? fallbackT
  try {
    const d = new Date(iso)
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfSessionDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const dayDiff = Math.round((startOfToday - startOfSessionDay) / 86400000)
    if (dayDiff <= 0) {
      const time = formatTime(d)
      return opts?.bucket === 'today' ? t('time.timeOnly', { time }) : t('time.todayAt', { time })
    }
    if (dayDiff === 1) {
      const time = formatTime(d)
      return opts?.bucket === 'yesterday' ? t('time.timeOnly', { time }) : t('time.yesterdayAt', { time })
    }
    // For older dates fall back to the platform's locale-aware
    // formatter using <html lang>. Avoids hard-coding 'en-US' which
    // produced "Sep 24" even in Chinese.
    const locale = typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : undefined
    return getMonthDayFormatter(locale, d.getFullYear() !== now.getFullYear()).format(d)
  } catch {
    return iso.slice(0, 10)
  }
}

function formatTime(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

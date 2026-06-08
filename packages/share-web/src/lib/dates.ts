// Centralised date helpers so Profile / Me / Tombstone don't drift to
// different formats. `humanDate` matches the Reader's masthead format
// (e.g. "Jun 4, 2026") so a published-on cell on /@handle reads the
// same as the masthead on the share page it links to.
//
// All helpers gate on `Number.isFinite(ts)` before constructing a
// Date — `new Date(NaN)` doesn't throw, it silently produces "Invalid
// Date" which then leaks to the UI. Wrapping in try/catch isn't enough.

export function humanDate(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  try {
    return new Date(ts).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function humanDateTime(ts: number): string {
  if (!Number.isFinite(ts)) return ''
  try {
    return new Date(ts).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

/**
 * Relative-time label for list rows: "Today" / "Yesterday" / "Nd ago"
 * up to one week, then falls back to `humanDate`. Pattern matches
 * Notion / Linear / GitHub list timestamps.
 *
 * `now` is injectable so tests can pin the clock without monkey-patching
 * Date globally.
 */
export function relativeDate(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || !Number.isFinite(now)) return ''
  const diffMs = now - ts
  if (diffMs < 60_000) return 'Just now'
  const oneDay = 24 * 3600 * 1000
  const startOfDay = (t: number) => {
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / oneDay)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return humanDate(ts)
}

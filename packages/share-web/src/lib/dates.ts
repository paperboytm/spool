// Centralised date helpers so Profile / Me / Tombstone don't drift to
// different formats. `humanDate` matches the Reader's masthead format
// (e.g. "Jun 4, 2026") so a published-on cell on /@handle reads the
// same as the masthead on the share page it links to.

export function humanDate(ts: number): string {
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

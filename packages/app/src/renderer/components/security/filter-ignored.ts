import type { AllowlistEntryRow } from '@spool-lab/core'
import { SENSITIVE_KIND_LABEL, type SensitiveKind } from '@spool-lab/redact'

export type ScopeFilter = 'all' | 'global' | 'session'

// Pure predicate + sort behind the "Ignored items" modal toolbar. The
// scope dropdown narrows by entry.scope, the type dropdown by entry.kind,
// and the free-text box matches the kind label, the live value, or the
// session title (case-insensitive). Results are newest-first by createdAt.
export function filterIgnoredEntries(
  entries: AllowlistEntryRow[],
  opts: { scope: ScopeFilter; kind: string | null; query: string },
): AllowlistEntryRow[] {
  const q = opts.query.trim().toLowerCase()
  const match = (e: AllowlistEntryRow): boolean => {
    if (opts.scope !== 'all' && e.scope !== opts.scope) return false
    if (opts.kind !== null && e.kind !== opts.kind) return false
    if (!q) return true
    const kindLabel = (SENSITIVE_KIND_LABEL[e.kind as SensitiveKind] ?? e.kind).toLowerCase()
    return (
      kindLabel.includes(q) ||
      (e.value ?? '').toLowerCase().includes(q) ||
      (e.sessionTitle ?? '').toLowerCase().includes(q)
    )
  }
  return entries.filter(match).slice().sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

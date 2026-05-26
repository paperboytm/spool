import { describe, it, expect } from 'vitest'
import type { AllowlistEntryRow } from '@spool-lab/core'
import { filterIgnoredEntries } from './filter-ignored.js'

function row(p: Partial<AllowlistEntryRow>): AllowlistEntryRow {
  return {
    scope: 'global',
    kind: 'api-key',
    valueHash: 'h',
    createdAt: '2026-05-01T00:00:00Z',
    sessionUuid: null,
    sessionTitle: null,
    value: null,
    ...p,
  } as AllowlistEntryRow
}

const entries: AllowlistEntryRow[] = [
  row({ kind: 'api-key', scope: 'global', valueHash: 'a', value: 'AKIAEXAMPLE123', createdAt: '2026-05-01T00:00:00Z' }),
  row({ kind: 'email', scope: 'session', valueHash: 'b', value: 'jane@acme.test', sessionUuid: 's1', sessionTitle: 'Billing chat', createdAt: '2026-05-03T00:00:00Z' }),
  row({ kind: 'api-key', scope: 'session', valueHash: 'c', value: 'sk-secret-xyz', sessionUuid: 's2', sessionTitle: 'Infra notes', createdAt: '2026-05-02T00:00:00Z' }),
]

describe('filterIgnoredEntries', () => {
  it('returns all entries newest-first with no filters', () => {
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: null, query: '' })
    expect(out.map((e) => e.valueHash)).toEqual(['b', 'c', 'a'])
  })

  it('narrows by scope', () => {
    const global = filterIgnoredEntries(entries, { scope: 'global', kind: null, query: '' })
    expect(global.map((e) => e.valueHash)).toEqual(['a'])
    const session = filterIgnoredEntries(entries, { scope: 'session', kind: null, query: '' })
    expect(session.map((e) => e.valueHash)).toEqual(['b', 'c'])
  })

  it('narrows by kind', () => {
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: 'api-key', query: '' })
    expect(out.map((e) => e.valueHash)).toEqual(['c', 'a'])
  })

  it('matches free text against the value', () => {
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: null, query: 'akia' })
    expect(out.map((e) => e.valueHash)).toEqual(['a'])
  })

  it('matches free text against the session title', () => {
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: null, query: 'billing' })
    expect(out.map((e) => e.valueHash)).toEqual(['b'])
  })

  it('matches free text against the kind label, not just the raw kind', () => {
    // SENSITIVE_KIND_LABEL maps 'api-key' to a human label; querying that
    // label should still match.
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: null, query: 'key' })
    expect(out.map((e) => e.valueHash).sort()).toEqual(['a', 'c'])
  })

  it('combines scope + kind + query', () => {
    const out = filterIgnoredEntries(entries, { scope: 'session', kind: 'api-key', query: 'sk-' })
    expect(out.map((e) => e.valueHash)).toEqual(['c'])
  })

  it('returns empty when nothing matches', () => {
    const out = filterIgnoredEntries(entries, { scope: 'all', kind: null, query: 'nope-no-match' })
    expect(out).toEqual([])
  })
})

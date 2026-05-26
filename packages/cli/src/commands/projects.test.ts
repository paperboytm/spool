import { describe, expect, it } from 'vitest'
import type { ProjectGroup } from '@spool-lab/core'
import { resolveProjectQuery } from './projects.js'

function group(displayName: string, identityKey: string): ProjectGroup {
  return {
    identityKind: 'path',
    identityKey,
    displayName,
    sources: ['claude'],
    sessionCount: 1,
    lastSessionAt: '2026-04-10T10:00:00Z',
  }
}

const groups: ProjectGroup[] = [
  group('spool', 'github.com/spool-lab/spool'),
  group('spool-daemon', 'github.com/spool-lab/spool-daemon'),
  group('quilt', 'github.com/graydawnc/quilt'),
  group('Asks', 'ask'),
]

describe('resolveProjectQuery', () => {
  it('resolves a unique substring match', () => {
    expect(resolveProjectQuery(groups, 'quilt')).toEqual({ kind: 'match', group: groups[2] })
  })

  it('is case-insensitive', () => {
    expect(resolveProjectQuery(groups, 'ASKS')).toEqual({ kind: 'match', group: groups[3] })
  })

  it('prefers an exact name match over substring matches', () => {
    // "spool" is a substring of "spool-daemon" too, but the exact name wins.
    expect(resolveProjectQuery(groups, 'spool')).toEqual({ kind: 'match', group: groups[0] })
  })

  it('resolves on a full identity key', () => {
    expect(resolveProjectQuery(groups, 'github.com/spool-lab/spool-daemon'))
      .toEqual({ kind: 'match', group: groups[1] })
  })

  it('matches against the identity key as well as the name', () => {
    expect(resolveProjectQuery(groups, 'graydawnc')).toEqual({ kind: 'match', group: groups[2] })
  })

  it('reports ambiguity when several projects match a substring', () => {
    const res = resolveProjectQuery(groups, 'spool-lab')
    expect(res.kind).toBe('ambiguous')
    if (res.kind === 'ambiguous') {
      expect(res.groups).toEqual([groups[0], groups[1]])
    }
  })

  it('reports ambiguity when two projects share the same name', () => {
    // Same display name, different identities (e.g. a local path vs a git
    // remote) — an exact name hit can't pick one, so disambiguate by key.
    const sameName = [
      group('openclaw', '/Users/me/openclaw'),
      group('openclaw', 'github.com/openclaw/openclaw'),
    ]
    const res = resolveProjectQuery(sameName, 'openclaw')
    expect(res.kind).toBe('ambiguous')
    if (res.kind === 'ambiguous') {
      expect(res.groups).toEqual(sameName)
    }
    // The full identity key still resolves uniquely.
    expect(resolveProjectQuery(sameName, 'github.com/openclaw/openclaw'))
      .toEqual({ kind: 'match', group: sameName[1] })
  })

  it('reports none when nothing matches', () => {
    expect(resolveProjectQuery(groups, 'nonexistent')).toEqual({ kind: 'none' })
  })
})

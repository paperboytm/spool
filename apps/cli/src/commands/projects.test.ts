import { describe, expect, it } from 'vitest'
import type { ProjectGroupWithPaths } from '@spool-lab/core'
import { resolveProjectQuery } from './projects.js'

function group(displayName: string, identityKey: string): ProjectGroupWithPaths {
  return {
    identityKind: 'path',
    identityKey,
    displayName,
    displayPaths: [],
    cwds: [],
    sources: ['claude'],
    sessionCount: 1,
    lastSessionAt: '2026-04-10T10:00:00Z',
  }
}

const groups: ProjectGroupWithPaths[] = [
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

  it('matches against project display paths', () => {
    const local = {
      ...group('inventory', '/Users/me/src/inventory'),
      displayPaths: ['/Users/me/src/inventory'],
    }
    expect(resolveProjectQuery([local], 'src/inventory')).toEqual({ kind: 'match', group: local })
  })

  it('matches against session cwd paths', () => {
    const monorepo = {
      ...group('platform', 'github.com/acme/platform'),
      displayPaths: ['/Users/me/src/platform'],
      cwds: ['/Users/me/src/platform/packages/api'],
    }
    expect(resolveProjectQuery([monorepo], 'packages/api')).toEqual({ kind: 'match', group: monorepo })
  })

  it('uses cwd substring matches only when names and identity keys do not match', () => {
    const service = group('data-service-main', 'git.example.com/acme/service-main')
    const worker = group('data-service-worker', 'github.com/example/data-service-worker')
    const scratch = {
      ...group('scratch', '/Users/example/.git'),
      cwds: ['/Users/example/work/data-service'],
    }

    const res = resolveProjectQuery([service, scratch, worker], 'data-service')

    expect(res.kind).toBe('ambiguous')
    if (res.kind === 'ambiguous') {
      expect(res.groups).toEqual([service, worker])
    }
  })

  it('an exact project-path basename preempts a previously-unique name substring match', () => {
    // Before the basename tier existed, "api" resolved uniquely to
    // gateway-api-service by name substring. A project whose directory is
    // literally named "api" now wins — pin that flip so it stays deliberate.
    const gateway = group('gateway-api-service', 'github.com/acme/gateway-api-service')
    const apiDir = {
      ...group('backend', 'github.com/acme/backend'),
      displayPaths: ['/Users/me/api'],
    }

    expect(resolveProjectQuery([gateway, apiDir], 'api')).toEqual({ kind: 'match', group: apiDir })
  })

  it('prefers exact identity basename matches over display name substrings', () => {
    const service = group('data-service-main', 'git.example.com/acme/data-service')
    const worker = group('data-service-worker', 'github.com/example/data-service-worker')
    const scratch = {
      ...group('scratch', '/Users/example/.git'),
      cwds: ['/Users/example/work/data-service'],
    }

    expect(resolveProjectQuery([service, scratch, worker], 'data-service')).toEqual({ kind: 'match', group: service })
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

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  addSubscription,
  canonicalSubscriptionPath,
  loadSubscriptions,
  removeSubscription,
  saveSubscriptions,
  subscriptionsPath,
} from './subscriptions.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('subscriptions store', () => {
  it('returns no subscriptions when the file does not exist', () => {
    const home = tempDir('spool-subs-')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('round-trips subscriptions under a temporary HOME', () => {
    const home = tempDir('spool-subs-')
    const subscription = {
      path: '/repos/spool',
      visibility: 'team' as const,
      teamId: 'team_00000001',
      teamName: 'Paperboy',
      addedAt: '2026-07-24T00:00:00.000Z',
    }
    const savedPath = saveSubscriptions([subscription], { homeDir: home })
    expect(savedPath).toBe(join(home, '.spool', 'subscriptions.json'))
    expect(subscriptionsPath({ homeDir: home })).toBe(savedPath)
    expect(statSync(savedPath).mode & 0o777).toBe(0o600)
    expect(loadSubscriptions({ homeDir: home })).toEqual([subscription])
  })

  it('adds once, updates visibility in place, and removes', () => {
    const home = tempDir('spool-subs-')
    const base = {
      path: '/repos/spool',
      visibility: 'link-only' as const,
      addedAt: '2026-07-24T00:00:00.000Z',
    }
    expect(addSubscription(base, { homeDir: home }).added).toBe(true)
    expect(addSubscription(base, { homeDir: home }).added).toBe(false)

    const updated = addSubscription(
      { ...base, visibility: 'team', teamId: 'team_00000001', addedAt: 'later' },
      { homeDir: home },
    )
    expect(updated.added).toBe(false)
    // The original subscription date survives a settings update.
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      { ...base, visibility: 'team', teamId: 'team_00000001' },
    ])

    expect(removeSubscription('/repos/other', { homeDir: home }).removed).toBe(false)
    expect(removeSubscription('/repos/spool', { homeDir: home }).removed).toBe(true)
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('rejects malformed subscription files with the offending path', () => {
    const home = tempDir('spool-subs-')
    mkdirSync(join(home, '.spool'), { recursive: true })
    writeFileSync(join(home, '.spool', 'subscriptions.json'), '{"subscriptions": [{}]}')
    expect(() => loadSubscriptions({ homeDir: home })).toThrow(/entry 0 has no path/)
  })

  it('stores Project bindings as v4 and fails closed for legacy v2 bindings', () => {
    const home = tempDir('spool-subs-')
    const project = {
      hubUrl: 'https://hub.test',
      actorId: 'user_1',
      tenant: { kind: 'user' as const, id: 'user_1' },
      localIdentity: {
        kind: 'git_remote' as const,
        key: 'github.com/acme/spool',
        displayName: 'spool',
      },
      remote: {
        id: 'project_1',
        slug: 'spool',
        name: 'Spool',
        description: null,
        github_url: null,
        owner: { kind: 'user' as const, id: 'user_1', handle: 'evan', name: 'Evan' },
        can_manage: true,
      },
    }
    const entry = {
      path: '/repos/spool',
      visibility: 'public' as const,
      project,
      addedAt: '2026-07-26T00:00:00.000Z',
    }
    const path = saveSubscriptions([entry], { homeDir: home })
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe(4)
    expect(loadSubscriptions({ homeDir: home })).toEqual([entry])

    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        subscriptions: [{ ...entry, project: { actorId: 'user_1', ...project } }],
      }),
    )
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      {
        path: entry.path,
        visibility: entry.visibility,
        addedAt: entry.addedAt,
      },
    ])
  })

  it('keeps Team ownership for Public and Link-only Project subscriptions', () => {
    const home = tempDir('spool-subs-')
    const project = {
      hubUrl: 'https://hub.test',
      actorId: 'user_1',
      tenant: { kind: 'team' as const, id: 'team_1' },
      localIdentity: {
        kind: 'git_remote' as const,
        key: 'github.com/paperboytm/spool',
        displayName: 'spool',
      },
      remote: {
        id: 'project_1',
        slug: 'spool',
        name: 'Spool',
        description: null,
        github_url: null,
        owner: { kind: 'team' as const, id: 'team_1', handle: 'paperboy', name: 'Paperboy' },
        can_manage: true,
      },
    }
    const entries = [
      {
        path: '/repos/spool',
        visibility: 'public' as const,
        teamId: 'team_1',
        teamName: 'Paperboy',
        project,
        addedAt: '2026-07-26T00:00:00.000Z',
      },
      {
        path: '/repos/private',
        visibility: 'link-only' as const,
        teamId: 'team_1',
        teamName: 'Paperboy',
        project,
        addedAt: '2026-07-26T00:00:00.000Z',
      },
    ]
    saveSubscriptions(entries, { homeDir: home })
    expect(loadSubscriptions({ homeDir: home })).toEqual(entries)
  })

  it('rejects mismatched Team ownership in v4 files', () => {
    const home = tempDir('spool-subs-')
    mkdirSync(join(home, '.spool'), { recursive: true })
    const path = join(home, '.spool', 'subscriptions.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 4,
        subscriptions: [
          {
            path: '/repos/spool',
            visibility: 'public',
            teamId: 'team_wrong',
            project: {
              hubUrl: 'https://hub.test',
              actorId: 'user_1',
              tenant: { kind: 'team', id: 'team_1' },
              localIdentity: {
                kind: 'git_remote',
                key: 'github.com/paperboytm/spool',
                displayName: 'spool',
              },
              remote: {
                id: 'project_1',
                slug: 'spool',
                name: 'Spool',
                description: null,
                github_url: null,
                owner: {
                  kind: 'team',
                  id: 'team_1',
                  handle: 'paperboy',
                  name: 'Paperboy',
                },
                can_manage: true,
              },
            },
            addedAt: '2026-07-26T00:00:00.000Z',
          },
        ],
      }),
    )
    expect(() => loadSubscriptions({ homeDir: home })).toThrow(/mismatched Team ownership/)
  })

  it('canonicalizes relative inputs and rejects files', () => {
    const dir = tempDir('spool-subs-target-')
    const child = join(dir, 'project')
    mkdirSync(child)
    writeFileSync(join(dir, 'file.txt'), 'x')

    expect(canonicalSubscriptionPath('project', dir)).toBe(canonicalSubscriptionPath(child))
    expect(() => canonicalSubscriptionPath(join(dir, 'missing'))).toThrow()
    expect(() => canonicalSubscriptionPath(join(dir, 'file.txt'))).toThrow(/Not a directory/)
  })
})

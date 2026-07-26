import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runMigrations } from '@spool-lab/core'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { Subscription } from '../subscriptions.js'
import { createTextUi } from '../ui.js'
import {
  autoPublishStateKey,
  listCandidatesFromIndex,
  mostSpecificMatchingSubscription,
  publishTarget,
  runAutoPublish,
  type AutoPublishCandidate,
  type AutoPublishDependencies,
} from './auto-publish.js'
import type { PreparedShare } from './share-pipeline.js'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-auto-publish-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function capturingUi() {
  const output: string[] = []
  const errors: string[] = []
  return {
    ui: createTextUi(
      (message) => output.push(message),
      (message) => errors.push(message),
    ),
    output,
    errors,
  }
}

const LOGGED_IN_ENV = { SPOOL_HUB_URL: 'https://hub.test', SPOOL_HUB_TOKEN: 'test-token' }
const SUBSCRIPTION: Subscription = {
  path: '/repos/spool',
  visibility: 'public',
  project: {
    hubUrl: 'https://hub.test',
    actorId: 'user_00000001',
    tenant: { kind: 'user', id: 'user_00000001' },
    localIdentity: {
      kind: 'git_remote',
      key: 'github.com/paperboytm/spool',
      displayName: 'spool',
    },
    remote: {
      id: 'project_personal01',
      slug: 'spool',
      name: 'Spool',
      description: null,
      github_url: 'https://github.com/paperboytm/spool',
      owner: { kind: 'user', id: 'user_00000001', handle: 'evan', name: 'Evan' },
      can_manage: true,
    },
  },
  addedAt: '2026-07-24T00:00:00.000Z',
}
const TEAM_PROJECT = {
  ...SUBSCRIPTION.project!.remote,
  id: 'project_team000001',
  slug: 'paperboy',
  name: 'Paperboy',
  owner: { kind: 'team' as const, id: 'team_00000001', handle: 'paperboy', name: 'Paperboy' },
}
const TEAM_SUBSCRIPTION: Subscription = {
  ...SUBSCRIPTION,
  visibility: 'team',
  teamId: 'team_00000001',
  teamName: 'Paperboy',
  project: {
    ...SUBSCRIPTION.project!,
    tenant: { kind: 'team', id: 'team_00000001' },
    remote: TEAM_PROJECT,
  },
}

function candidate(overrides: Partial<AutoPublishCandidate> = {}): AutoPublishCandidate {
  return {
    provider: 'claude',
    sessionUuid: 'abc12345',
    filePath: '/repos/spool/session.jsonl',
    cwd: '/repos/spool/src',
    localIdentity: {
      kind: 'git_remote',
      key: 'github.com/paperboytm/spool',
      displayName: 'spool',
    },
    jsonl: '{"type":"message"}',
    ...overrides,
  }
}

function fakePrepared(records: string[]): PreparedShare {
  return {
    sid: 'claude_abc12345',
    provider: 'claude',
    count: records.length,
    root: 'root-oid',
    manifest: records.map((_, index) => `oid-${index}`),
    records: records.map((data, index) => ({ oid: `oid-${index}`, data })),
    view: {} as PreparedShare['view'],
    viewOid: 'view-oid',
    viewData: '{}',
    lineageJson: null,
  }
}

function engineDeps(
  overrides: Partial<AutoPublishDependencies> = {},
): AutoPublishDependencies & { savedStates: unknown[] } {
  const savedStates: unknown[] = []
  return {
    env: LOGGED_IN_ENV,
    homeDir: tempHome(),
    // 404 on the session-meta lookup: no pre-existing Summary to preserve.
    fetch: async () => new Response('not found', { status: 404 }),
    match: { resolvers: [], listWorktrees: () => [] },
    loadSubscriptions: () => [SUBSCRIPTION],
    listProjects: async () => ({
      actor: { id: 'user_00000001' },
      projects: [SUBSCRIPTION.project!.remote, TEAM_PROJECT],
    }),
    listCandidates: () => [candidate()],
    prepare: async () => fakePrepared(['{"type":"message"}']),
    publish: async () => ({ url: 'https://hub.test/s/claude_abc12345' }),
    loadState: () => ({ version: 2, sessions: {} }),
    saveState: (state) => savedStates.push(state),
    savedStates,
    ...overrides,
  }
}

describe('runAutoPublish', () => {
  it('queries candidates through the migrated SQLite schema used in production', () => {
    const db = new Database(':memory:')
    try {
      runMigrations(db)
      db.prepare(
        `INSERT INTO projects
          (source_id, slug, display_path, display_name, identity_kind, identity_key)
         VALUES (
           (SELECT id FROM sources WHERE name = 'codex'),
           'spool',
           '/repos/spool',
           'Spool',
           'git_remote',
           'github.com/paperboytm/spool'
         )`,
      ).run()
      db.prepare(
        `INSERT INTO sessions
          (project_id, source_id, session_uuid, file_path, title, started_at, ended_at,
           message_count, has_tool_use, cwd, raw_file_mtime)
         VALUES (
           (SELECT id FROM projects WHERE slug = 'spool'),
           (SELECT id FROM sources WHERE name = 'codex'),
           '019f0000-0000-7000-8000-000000000001',
           '/repos/spool/session.jsonl',
           'Ship Projects',
           '2026-07-26T00:00:00.000Z',
           '2026-07-26T01:00:00.000Z',
           1,
           0,
           '/repos/spool',
           '2026-07-26T01:00:00.000Z'
         )`,
      ).run()

      expect(listCandidatesFromIndex(db)).toEqual([
        {
          provider: 'codex',
          sessionUuid: '019f0000-0000-7000-8000-000000000001',
          filePath: '/repos/spool/session.jsonl',
          cwd: '/repos/spool',
          localIdentity: {
            kind: 'git_remote',
            key: 'github.com/paperboytm/spool',
            displayName: 'Spool',
          },
        },
      ])
    } finally {
      db.close()
    }
  })

  it('returns null when nothing is subscribed', async () => {
    const { ui, output, errors } = capturingUi()
    const result = await runAutoPublish(ui, engineDeps({ loadSubscriptions: () => [] }))
    expect(result).toBeNull()
    expect(output).toEqual([])
    expect(errors).toEqual([])
  })

  it('warns and stays local when subscriptions exist but no hub token does', async () => {
    const { ui, output } = capturingUi()
    const result = await runAutoPublish(ui, engineDeps({ env: {} }))
    expect(result).toBeNull()
    expect(output.join('\n')).toContain('not logged in')
  })

  it('publishes a changed subscribed session and records its fingerprint', async () => {
    const { ui, output } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/claude_abc12345' }))
    const deps = engineDeps({ publish })

    const result = await runAutoPublish(ui, deps)
    expect(result).toEqual({
      matched: 1,
      published: [{ sid: 'claude_abc12345', url: 'https://hub.test/s/claude_abc12345' }],
      unchanged: 0,
      skippedSecrets: 0,
      skippedUnbound: 0,
      failed: 0,
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(output).toEqual([])

    const state = deps.savedStates[0] as {
      sessions: Record<string, { fingerprint: string; url: string }>
    }
    const key = autoPublishStateKey('https://hub.test', 'user_00000001', 'claude_abc12345')
    expect(state.sessions[key]?.url).toBe('https://hub.test/s/claude_abc12345')
    expect(state.sessions[key]?.fingerprint).toMatch(/^sha256:/)
  })

  it('skips sessions whose fingerprint has not changed', async () => {
    const { ui } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/x' }))
    const deps = engineDeps({ publish })

    const first = await runAutoPublish(ui, deps)
    const recorded = (deps.savedStates[0] as { sessions: Record<string, { fingerprint: string }> })
      .sessions
    const second = await runAutoPublish(
      ui,
      engineDeps({ publish, loadState: () => ({ version: 2, sessions: recorded }) }),
    )

    expect(first?.published).toHaveLength(1)
    expect(second).toMatchObject({ published: [], unchanged: 1 })
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('ignores sessions outside every subscription', async () => {
    const { ui } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/x' }))
    const result = await runAutoPublish(
      ui,
      engineDeps({ publish, listCandidates: () => [candidate({ cwd: '/elsewhere/project' })] }),
    )
    expect(result).toMatchObject({ matched: 0, published: [] })
    expect(publish).not.toHaveBeenCalled()
  })

  it('uses the most specific nested subscription regardless of file order', async () => {
    const nested: Subscription = {
      ...SUBSCRIPTION,
      path: '/repos/spool/packages/vapor',
      visibility: 'link-only',
      project: {
        ...SUBSCRIPTION.project!,
        localIdentity: {
          kind: 'git_remote',
          key: 'github.com/paperboytm/react-vapor',
          displayName: 'react-vapor',
        },
        remote: {
          ...SUBSCRIPTION.project!.remote,
          id: 'project_vapor00001',
          slug: 'react-vapor',
          name: 'React Vapor',
        },
      },
    }
    const nestedCandidate = candidate({
      cwd: '/repos/spool/packages/vapor/src',
      localIdentity: nested.project!.localIdentity,
    })
    expect(
      mostSpecificMatchingSubscription(nestedCandidate.cwd, [SUBSCRIPTION, nested], {
        resolvers: [],
        listWorktrees: () => [],
      }),
    ).toBe(nested)

    const seen: unknown[] = []
    const publish = vi.fn(async (_client: unknown, _prepared: unknown, options: unknown) => {
      seen.push(options)
      return { url: 'https://hub.test/s/x' }
    })
    const { ui } = capturingUi()
    const result = await runAutoPublish(
      ui,
      engineDeps({
        loadSubscriptions: () => [SUBSCRIPTION, nested],
        listProjects: async () => ({
          actor: { id: 'user_00000001' },
          projects: [SUBSCRIPTION.project!.remote, nested.project!.remote],
        }),
        listCandidates: () => [nestedCandidate],
        publish: publish as never,
      }),
    )

    expect(result).toMatchObject({ matched: 1, published: [{ sid: 'claude_abc12345' }] })
    expect(seen[0]).toMatchObject({
      visibility: 'link-only',
      projectId: nested.project!.remote.id,
    })
  })

  it('never auto-publishes a session with secret findings and warns once per content', async () => {
    const { ui, output } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/x' }))
    const deps = engineDeps({
      publish,
      prepare: async () => fakePrepared(['{"key":"AKIAQZWSXEDCRFVTGBYH"}']),
    })

    const result = await runAutoPublish(ui, deps)
    expect(result).toMatchObject({ skippedSecrets: 1, published: [] })
    expect(publish).not.toHaveBeenCalled()
    expect(output.join('\n')).toContain('Skipped auto-publish')

    const recorded = (
      deps.savedStates[0] as {
        sessions: Record<string, { fingerprint: string; skippedSecrets?: boolean }>
      }
    ).sessions
    const key = autoPublishStateKey('https://hub.test', 'user_00000001', 'claude_abc12345')
    expect(recorded[key]?.skippedSecrets).toBe(true)

    // The unchanged transcript does not warn again on the next pass.
    const { ui: secondUi, output: secondOutput } = capturingUi()
    const second = await runAutoPublish(
      secondUi,
      engineDeps({
        publish,
        prepare: async () => fakePrepared(['{"key":"AKIAQZWSXEDCRFVTGBYH"}']),
        loadState: () => ({ version: 2, sessions: recorded }),
      }),
    )
    expect(second).toMatchObject({ unchanged: 1, skippedSecrets: 0 })
    expect(secondOutput).toEqual([])
  })

  it('passes the subscribed disclosure through to publishing', async () => {
    const { ui } = capturingUi()
    const seen: unknown[] = []
    const publish = vi.fn(async (_client: unknown, _prepared: unknown, options: unknown) => {
      seen.push(options)
      return { url: 'https://hub.test/s/x' }
    })
    await runAutoPublish(
      ui,
      engineDeps({
        publish: publish as never,
        loadSubscriptions: () => [{ ...SUBSCRIPTION, visibility: 'link-only' }],
      }),
    )
    expect(seen[0]).toMatchObject({ visibility: 'link-only' })
    expect(seen[0]).toMatchObject({ projectId: 'project_personal01' })

    seen.length = 0
    await runAutoPublish(
      ui,
      engineDeps({
        publish: publish as never,
        loadSubscriptions: () => [TEAM_SUBSCRIPTION],
      }),
    )
    expect(seen[0]).toMatchObject({ visibility: 'team', teamId: 'team_00000001' })

    seen.length = 0
    await runAutoPublish(ui, engineDeps({ publish: publish as never }))
    expect(seen[0]).toMatchObject({ visibility: 'public' })
  })

  it('maps disclosure targets per provider support', () => {
    expect(publishTarget(SUBSCRIPTION, 'claude')).toEqual({ visibility: 'public' })
    // Public subscriptions degrade to Link-only for providers Explore
    // does not support yet, instead of failing every pass.
    expect(publishTarget(SUBSCRIPTION, 'gemini')).toEqual({ visibility: 'link-only' })
    expect(publishTarget(TEAM_SUBSCRIPTION, 'gemini')).toEqual({
      visibility: 'team',
      teamId: 'team_00000001',
    })
    expect(publishTarget({ ...SUBSCRIPTION, visibility: 'link-only' }, 'claude')).toEqual({
      visibility: 'link-only',
    })
  })

  it('counts publish failures without aborting the pass', async () => {
    const { ui, output } = capturingUi()
    const result = await runAutoPublish(
      ui,
      engineDeps({
        publish: async () => {
          throw new Error('hub unavailable')
        },
      }),
    )
    expect(result).toMatchObject({ failed: 1, published: [] })
    expect(output.join('\n')).toContain('hub unavailable')
  })

  it('fails closed for legacy subscriptions without a Project binding', async () => {
    const { ui, output } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/x' }))
    const result = await runAutoPublish(
      ui,
      engineDeps({
        publish,
        loadSubscriptions: () => [
          {
            path: SUBSCRIPTION.path,
            visibility: 'public',
            addedAt: SUBSCRIPTION.addedAt,
          },
        ],
      }),
    )
    expect(result).toMatchObject({ skippedUnbound: 1, published: [] })
    expect(publish).not.toHaveBeenCalled()
    expect(output.join('\n')).toContain('legacy subscription has no Hub Project')
  })

  it('fails closed when the subscription belongs to another Hub or account', async () => {
    const { ui, output } = capturingUi()
    const publish = vi.fn(async () => ({ url: 'https://hub.test/s/x' }))
    const wrongHub = await runAutoPublish(
      ui,
      engineDeps({
        publish,
        loadSubscriptions: () => [
          {
            ...SUBSCRIPTION,
            project: { ...SUBSCRIPTION.project!, hubUrl: 'https://other.test' },
          },
        ],
      }),
    )
    expect(wrongHub).toMatchObject({ skippedUnbound: 1, published: [] })

    const wrongActor = await runAutoPublish(
      ui,
      engineDeps({
        publish,
        listProjects: async () => ({ actor: { id: 'user_00000002' }, projects: [] }),
      }),
    )
    expect(wrongActor).toMatchObject({ skippedUnbound: 1, published: [] })
    expect(publish).not.toHaveBeenCalled()
    expect(output.join('\n')).toContain('different Hub')
    expect(output.join('\n')).toContain('different signed-in account')
  })

  it('scopes incremental state by Hub and actor', () => {
    const sid = 'claude_abc12345'
    expect(autoPublishStateKey('https://hub.test', 'user_1', sid)).not.toBe(
      autoPublishStateKey('https://other.test', 'user_1', sid),
    )
    expect(autoPublishStateKey('https://hub.test', 'user_1', sid)).not.toBe(
      autoPublishStateKey('https://hub.test', 'user_2', sid),
    )
  })
})

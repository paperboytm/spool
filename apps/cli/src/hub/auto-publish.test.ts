import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { Subscription } from '../subscriptions.js'
import { createTextUi } from '../ui.js'
import {
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
  addedAt: '2026-07-24T00:00:00.000Z',
}

function candidate(overrides: Partial<AutoPublishCandidate> = {}): AutoPublishCandidate {
  return {
    provider: 'claude',
    sessionUuid: 'abc12345',
    filePath: '/repos/spool/session.jsonl',
    cwd: '/repos/spool/src',
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
    listCandidates: () => [candidate()],
    prepare: async () => fakePrepared(['{"type":"message"}']),
    publish: async () => ({ url: 'https://hub.test/s/claude_abc12345' }),
    loadState: () => ({ version: 1, sessions: {} }),
    saveState: (state) => savedStates.push(state),
    savedStates,
    ...overrides,
  }
}

describe('runAutoPublish', () => {
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
      failed: 0,
    })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(output).toEqual([])

    const state = deps.savedStates[0] as {
      sessions: Record<string, { fingerprint: string; url: string }>
    }
    expect(state.sessions['claude_abc12345']?.url).toBe('https://hub.test/s/claude_abc12345')
    expect(state.sessions['claude_abc12345']?.fingerprint).toMatch(/^sha256:/)
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
      engineDeps({ publish, loadState: () => ({ version: 1, sessions: recorded }) }),
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
    expect(recorded['claude_abc12345']?.skippedSecrets).toBe(true)

    // The unchanged transcript does not warn again on the next pass.
    const { ui: secondUi, output: secondOutput } = capturingUi()
    const second = await runAutoPublish(
      secondUi,
      engineDeps({
        publish,
        prepare: async () => fakePrepared(['{"key":"AKIAQZWSXEDCRFVTGBYH"}']),
        loadState: () => ({ version: 1, sessions: recorded }),
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

    seen.length = 0
    await runAutoPublish(
      ui,
      engineDeps({
        publish: publish as never,
        loadSubscriptions: () => [
          { ...SUBSCRIPTION, visibility: 'team', teamId: 'team_00000001', teamName: 'Paperboy' },
        ],
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
    expect(
      publishTarget({ ...SUBSCRIPTION, visibility: 'team', teamId: 'team_00000001' }, 'gemini'),
    ).toEqual({ visibility: 'team', teamId: 'team_00000001' })
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
})

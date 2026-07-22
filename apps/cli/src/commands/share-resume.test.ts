import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

import { sequenceRoot, serializePortableSession } from '@spool-lab/session-kit'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import type { HubFetch } from '../hub/client.js'
import type { LocalSummaryAgent } from '../hub/local-summary-agent.js'
import type { CliSpinner, CliUi } from '../ui.js'
import { handleResumeCommand } from './resume.js'
import { handleShareCommand, latestSessionUuidFor } from './share.js'

// Command-level round trip against an in-memory hub that implements the
// same wire contract as the backend. `spool share` seeds it, then
// `spool resume` materializes from it into a temp HOME.

const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const HUB_URL = 'https://hub.test'

interface StoredHead {
  root: string
  count: number
  manifest: string[]
  sig: string | null
  cardJson: string | null
  summaryMd: string | null
  lineageJson: string | null
  viewOid: string
  spoolFileOid?: string | null
  withdrawn?: boolean
}

function makeHub() {
  const objects = new Map<string, string>()
  const sessions = new Map<string, StoredHead>()

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  const fetchImpl: HubFetch = async (input, init) => {
    const url = new URL(String(input))
    const path = url.pathname
    const method = init?.method ?? 'GET'
    const sidMatch = path.match(
      /^\/api\/hub\/v1\/sessions\/([^/]+)(?:\/(push|head|records|view|withdraw))?$/,
    )

    if (method === 'POST' && path === '/api/hub/v1/objects/batch') {
      const lines = String(init?.body ?? '')
        .split('\n')
        .filter((line) => line.trim() !== '')
      for (const line of lines) {
        const { oid, data } = JSON.parse(line) as { oid: string; data: string }
        objects.set(oid, data)
      }
      return json({ stored: lines.length })
    }

    if (sidMatch) {
      const sid = decodeURIComponent(sidMatch[1] as string)
      const action = sidMatch[2]
      if (method === 'POST' && (action === 'push' || action === 'head')) {
        const body = JSON.parse(String(init?.body)) as StoredHead
        const wanted = [
          ...new Set([
            ...body.manifest,
            body.viewOid,
            ...(body.spoolFileOid ? [body.spoolFileOid] : []),
          ]),
        ]
        const missing = wanted.filter((oid) => !objects.has(oid))
        if (action === 'push') return json({ missing })
        if (missing.length > 0) return json({ error: 'CONFLICT', detail: 'objects missing' }, 409)
        sessions.set(sid, body)
        return json({ url: `${HUB_URL}/session/${sid}` })
      }
      const session = sessions.get(sid)
      if (!session) return json({ error: 'NOT_FOUND' }, 404)
      if (session.withdrawn) return json({ error: 'GONE', detail: 'withdrawn' }, 410)
      if (method === 'GET' && action === undefined) {
        return json({
          sid,
          root: session.root,
          count: session.count,
          sig: session.sig,
          summaryMd: session.summaryMd,
          cardJson: session.cardJson,
          lineageJson: session.lineageJson,
          viewOid: session.viewOid,
          createdAt: 1,
          updatedAt: 1,
          author: { handle: 'author', displayName: 'Author', avatarUrl: null },
        })
      }
      if (method === 'GET' && action === 'records') {
        const from = Number(url.searchParams.get('from') ?? '0')
        const to = Math.min(
          Number(url.searchParams.get('to') ?? String(session.count)),
          session.count,
        )
        const lines = session.manifest
          .slice(from, to)
          .map((oid, index) =>
            JSON.stringify({ i: from + index, oid, data: objects.get(oid) as string }),
          )
        return new Response(lines.join('\n') + (lines.length > 0 ? '\n' : ''), {
          status: 200,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      }
    }
    return json({ error: 'NOT_FOUND', detail: `unhandled ${method} ${path}` }, 404)
  }

  return { fetchImpl, objects, sessions }
}

function writeFixtureSession(workspaceRoot: string): string {
  const line = (record: Record<string, unknown>) => JSON.stringify(record)
  const jsonl =
    [
      line({
        type: 'user',
        uuid: 'u-1',
        parentUuid: null,
        sessionId: 'orig',
        cwd: workspaceRoot,
        timestamp: '2026-07-16T10:00:00.000Z',
        message: { role: 'user', content: 'rename alpha to beta in the demo file' },
      }),
      line({
        type: 'assistant',
        uuid: 'u-2',
        parentUuid: 'u-1',
        sessionId: 'orig',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Edit',
              input: {
                file_path: `${workspaceRoot}/src/demo.ts`,
                old_string: 'alpha',
                new_string: 'beta',
              },
            },
          ],
        },
      }),
      line({
        type: 'user',
        uuid: 'u-3',
        parentUuid: 'u-2',
        sessionId: 'orig',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
        },
        toolUseResult: { originalFile: 'alpha\nrest\n', oldString: 'alpha', newString: 'beta' },
      }),
      line({
        type: 'assistant',
        uuid: 'u-4',
        parentUuid: 'u-3',
        sessionId: 'orig',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done: renamed alpha to beta.' }],
        },
      }),
    ].join('\n') + '\n'
  const filePath = join(workspaceRoot, 'session.jsonl')
  writeFileSync(filePath, jsonl, 'utf8')
  return filePath
}

function interactiveUi(
  options: {
    confirm?: boolean | null | ((message: string) => boolean | null)
    selected?: 'claude' | 'codex'
    events?: string[]
  } = {},
): CliUi {
  const events = options.events ?? []
  const spinner = (): CliSpinner => ({
    start: (message) => events.push(`spinner:start:${message ?? ''}`),
    message: (message) => events.push(`spinner:message:${message ?? ''}`),
    stop: (message) => events.push(`spinner:stop:${message ?? ''}`),
    error: (message) => events.push(`spinner:error:${message ?? ''}`),
    cancel: (message) => events.push(`spinner:cancel:${message ?? ''}`),
  })
  return {
    interactive: true,
    intro: (message) => events.push(`intro:${message}`),
    note: (message, title) => events.push(`note:${title ?? ''}:${message}`),
    info: (message) => events.push(`info:${message}`),
    step: (message) => events.push(`step:${message}`),
    success: (message) => events.push(`success:${message}`),
    warn: (message) => events.push(`warn:${message}`),
    error: (message) => events.push(`error:${message}`),
    outro: (message) => events.push(`outro:${message}`),
    cancel: (message) => events.push(`cancel:${message}`),
    confirm: async (message, initialValue) => {
      events.push(`confirm:${message}:${initialValue === true ? 'yes' : 'no'}`)
      return typeof options.confirm === 'function'
        ? options.confirm(message)
        : (options.confirm ?? true)
    },
    select: async ({ message }) => {
      events.push(`select:${message}`)
      return options.selected ?? 'claude'
    },
    spinner,
  }
}

function shareDeps(
  hub: ReturnType<typeof makeHub>,
  workspaceRoot: string,
  filePath: string,
  home: string,
) {
  const logs: string[] = []
  const errors: string[] = []
  return {
    logs,
    errors,
    deps: {
      fetch: hub.fetchImpl,
      homeDir: home,
      env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: 'test-token' } as NodeJS.ProcessEnv,
      cwd: workspaceRoot,
      log: (message: string) => logs.push(message),
      error: (message: string) => errors.push(message),
      copyToClipboard: () => false,
      resolveTarget: () => ({
        provider: 'claude' as const,
        sessionUuid: SESSION_UUID,
        filePath,
        cwd: workspaceRoot,
      }),
    },
  }
}

describe('spool share local Agent Summary flow', () => {
  it('shows the installer when an npx caller does not have the spool command yet', async () => {
    const home = mkdtempSync(join(tmpdir(), 'spool-share-login-home-'))
    const events: string[] = []

    try {
      await expect(
        handleShareCommand(
          undefined,
          { agentSummary: false },
          {
            homeDir: home,
            env: {},
            cwd: '/tmp/example',
            ui: interactiveUi({ events }),
            resolveTarget: () => ({
              provider: 'claude',
              sessionUuid: SESSION_UUID,
              filePath: '/tmp/unused-session.jsonl',
              cwd: '/tmp/example',
            }),
          },
        ),
      ).resolves.toBe(1)

      expect(events.join('\n')).toContain('Not logged in. Run `spool login` first.')
      expect(events.join('\n')).toContain('npx @spool-lab/cli login')
      expect(events.join('\n')).toContain('https://spool.new/docs/installation')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('confirms the Public Session URL and copies it in an interactive terminal', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-share-complete-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-share-complete-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    let copied = ''

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false },
      {
        ...share.deps,
        ui: interactiveUi({ events }),
        copyToClipboard: async (text: string) => {
          copied = text
          return true
        },
      },
    )

    const url = `${HUB_URL}/session/claude_${SESSION_UUID}`
    expect(exit).toBe(0)
    expect(copied).toBe(url)
    expect(events).toContain(`note:Public Session URL:${url}`)
    expect(events).toContain(
      'confirm:Publish this Session as Public? It can appear in Explore and search.:yes',
    )
    expect(
      events.indexOf(
        'confirm:Publish this Session as Public? It can appear in Explore and search.:yes',
      ),
    ).toBeLessThan(events.indexOf('spinner:start:Uploading session'))
    expect(events).toContain('success:Session published. Link copied to clipboard.')
    expect(events.indexOf(`note:Public Session URL:${url}`)).toBeLessThan(
      events.indexOf('success:Session published. Link copied to clipboard.'),
    )
    expect(events).toContain(
      'info:This Session can appear in Explore and search. The source Session stays unchanged.',
    )
  })

  it('keeps a completed share successful when clipboard access is unavailable', async () => {
    for (const copyToClipboard of [
      async () => false,
      async () => {
        throw new Error('clipboard unavailable')
      },
    ]) {
      const hub = makeHub()
      const workspace = mkdtempSync(join(tmpdir(), 'spool-share-copy-fallback-'))
      const home = mkdtempSync(join(tmpdir(), 'spool-share-copy-fallback-home-'))
      const filePath = writeFixtureSession(workspace)
      const share = shareDeps(hub, workspace, filePath, home)
      const events: string[] = []

      const exit = await handleShareCommand(
        undefined,
        { agentSummary: false },
        {
          ...share.deps,
          ui: interactiveUi({ events }),
          copyToClipboard,
        },
      )

      const url = `${HUB_URL}/session/claude_${SESSION_UUID}`
      expect(exit).toBe(0)
      expect(events).toContain(`note:Public Session URL:${url}`)
      expect(events).toContain('success:Session published.')
      expect(events).toContain(
        'info:Could not copy automatically. Copy the Session URL above to share it.',
      )
    }
  })

  it('uploads first, detects installed Agents, then generates and uploads the Summary', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-flow-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-flow-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    const agents: LocalSummaryAgent[] = [
      { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
      { id: 'codex', name: 'Codex CLI', path: '/bin/codex' },
    ]
    let generatedAfterUpload = false

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      {},
      {
        ...share.deps,
        ui: interactiveUi({ selected: 'codex', events }),
        detectSummaryAgents: async () => {
          expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
          return agents
        },
        generateSummary: async (agent, prompt) => {
          generatedAfterUpload = hub.sessions.has(`claude_${SESSION_UUID}`)
          expect(agent.id).toBe('codex')
          expect(prompt).toContain('rename alpha to beta in the demo file')
          expect(prompt).not.toContain('Done: renamed alpha to beta.')
          return '## Outcome\n\nThe rename is ready.'
        },
      },
    )

    expect(exit).toBe(0)
    expect(generatedAfterUpload).toBe(true)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(
      '## Outcome\n\nThe rename is ready.',
    )
    expect(events.findIndex((event) => event.startsWith('note:Public Session URL:'))).toBeLessThan(
      events.findIndex((event) => event.startsWith('confirm:Generate a Summary')),
    )
    expect(events).toContain('select:Which local Agent should generate the Summary?')
  })

  it('does not prompt or invoke an Agent when non-interactive visibility is acknowledged', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-nontty-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-nontty-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    let detected = false

    const exit = await handleShareCommand(
      undefined,
      { visibilityConfirmed: true },
      {
        ...share.deps,
        detectSummaryAgents: async () => {
          detected = true
          return []
        },
      },
    )

    expect(exit).toBe(0)
    expect(detected).toBe(false)
    expect(share.logs.join('\n')).toContain(
      'This Session will be Public and can appear in Explore and search.',
    )
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
  })

  it('aborts before upload when non-interactive visibility is not acknowledged', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-nontty-unconfirmed-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-nontty-unconfirmed-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(undefined, { agentSummary: false }, share.deps)

    expect(exit).toBe(1)
    expect(hub.sessions.size).toBe(0)
    expect(share.errors.join('\n')).toContain('--visibility-confirmed')
  })

  it('preserves an existing Summary when the user declines regeneration', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-preserve-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-preserve-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    expect(
      await handleShareCommand(
        undefined,
        { summary: '## Existing\n\nKeep this Summary.', visibilityConfirmed: true },
        share.deps,
      ),
    ).toBe(0)

    const exit = await handleShareCommand(
      undefined,
      {},
      {
        ...share.deps,
        ui: interactiveUi({
          confirm: (message) => message.startsWith('Publish this Session as Public?'),
        }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
      },
    )

    expect(exit).toBe(0)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(
      '## Existing\n\nKeep this Summary.',
    )
  })

  it('leaves the uploaded session live when the user declines generation', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-decline-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-decline-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {},
      {
        ...share.deps,
        ui: interactiveUi({
          confirm: (message) => message.startsWith('Publish this Session as Public?'),
        }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
        generateSummary: async () => {
          throw new Error('must not run')
        },
      },
    )

    expect(exit).toBe(0)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
  })
})

describe('spool share → spool resume round trip', () => {
  it.each(['gemini', 'opencode', 'pi'] as const)(
    'shares indexed %s sessions through portable records',
    async (provider) => {
      const hub = makeHub()
      const workspace = mkdtempSync(join(tmpdir(), `spool-${provider}-share-`))
      const home = mkdtempSync(join(tmpdir(), `spool-${provider}-share-home-`))
      const sessionUuid = provider === 'opencode' ? 'ses_1234567890abcdef' : SESSION_UUID
      const jsonl = serializePortableSession({
        source: provider,
        sessionUuid,
        filePath: `/virtual/${provider}`,
        title: `Share ${provider}`,
        cwd: workspace,
        model: '',
        startedAt: '2026-07-19T00:00:00.000Z',
        endedAt: '2026-07-19T00:00:01.000Z',
        messages: [
          {
            uuid: 'portable-user',
            parentUuid: null,
            role: 'user',
            contentText: `hello from ${provider}`,
            timestamp: '2026-07-19T00:00:00.000Z',
            isSidechain: false,
            toolNames: [],
            seq: 0,
          },
        ],
      })
      const logs: string[] = []
      const errors: string[] = []

      const exit = await handleShareCommand(
        sessionUuid,
        { agentSummary: false, visibilityConfirmed: true },
        {
          fetch: hub.fetchImpl,
          homeDir: home,
          env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: 'test-token' } as NodeJS.ProcessEnv,
          cwd: workspace,
          log: (message: string) => logs.push(message),
          error: (message: string) => errors.push(message),
          resolveTarget: () => ({
            provider,
            sessionUuid,
            filePath: `/virtual/${provider}`,
            cwd: workspace,
            jsonl,
          }),
        },
      )

      expect(exit).toBe(0)
      expect(errors).toEqual([])
      expect(hub.sessions.get(`${provider}_${sessionUuid}`)).toBeDefined()
      expect(logs.join('\n')).toContain(`${HUB_URL}/session/${provider}_${sessionUuid}`)
    },
  )

  it('explains that portable shares are readable but not natively resumable', async () => {
    const errors: string[] = []
    const exit = await handleResumeCommand(
      `pi_${SESSION_UUID}`,
      {},
      {
        fetch: async () => {
          throw new Error('must not fetch')
        },
        env: {} as NodeJS.ProcessEnv,
        log: () => {},
        error: (message: string) => errors.push(message),
      },
    )

    expect(exit).toBe(1)
    expect(errors.join('\n')).toContain(
      'pi sessions can be shared and read, but native Resume is not supported yet.',
    )
  })

  it('shares through the 3-step handshake and resumes into a fresh local session', async () => {
    const hub = makeHub()
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-author-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-author-home-'))
    const filePath = writeFixtureSession(authorWs)
    const share = shareDeps(hub, authorWs, filePath, authorHome)

    const summary = '## Outcome\n\nReady for review.'
    const shareExit = await handleShareCommand(
      undefined,
      { summary, visibilityConfirmed: true },
      share.deps,
    )
    expect(share.errors).toEqual([])
    expect(shareExit).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    const head = hub.sessions.get(sid)
    expect(head).toBeDefined()
    expect(head?.count).toBe(4)
    expect(head?.root).toBe(await sequenceRoot(head?.manifest ?? []))
    expect(head?.summaryMd).toBe(summary)
    expect(hub.objects.has(head?.viewOid ?? '')).toBe(true)
    for (const oid of head?.manifest ?? []) {
      expect(hub.objects.get(oid)).not.toContain(authorWs)
    }
    expect(share.logs.join('\n')).toContain(`${HUB_URL}/session/${sid}`)

    // Resume on a "different machine": new HOME, new workspace. The
    // workspace is passed through a SYMLINK on purpose — Claude Code
    // names project dirs after the real path (macOS /tmp → /private/tmp),
    // so materialization must resolve it or --resume never finds the file.
    const resumerWs = realpathSync(mkdtempSync(join(tmpdir(), 'spool-resumer-ws-')))
    const resumerHome = mkdtempSync(join(tmpdir(), 'spool-resumer-home-'))
    const aliasWs = join(mkdtempSync(join(tmpdir(), 'spool-alias-')), 'ws-link')
    symlinkSync(resumerWs, aliasWs)
    const logs: string[] = []
    const errors: string[] = []
    const spawnCalls: Array<{ cmd: string; args: readonly string[]; cwd: unknown }> = []
    const fakeSpawn = ((cmd: string, args: readonly string[], opts: { cwd?: unknown }) => {
      spawnCalls.push({ cmd, args, cwd: opts.cwd })
      return { status: 0 }
    }) as unknown as typeof import('node:child_process').spawnSync
    const resumeExit = await handleResumeCommand(
      `${HUB_URL}/session/${sid}`,
      { workspace: aliasWs },
      {
        fetch: hub.fetchImpl,
        homeDir: resumerHome,
        env: {} as NodeJS.ProcessEnv,
        log: (message: string) => logs.push(message),
        error: (message: string) => errors.push(message),
        spawn: fakeSpawn,
      },
    )
    expect(errors).toEqual([])
    expect(resumeExit).toBe(0)

    const projectDir = join(
      resumerHome,
      '.claude',
      'projects',
      resumerWs.replace(/[^a-zA-Z0-9]/g, '-'),
    )
    const files = readdirSync(projectDir)
    expect(files).toHaveLength(1)
    const materialized = readFileSync(join(projectDir, files[0] as string), 'utf8')
    const lines = materialized.trim().split('\n')
    expect(lines).toHaveLength(5)
    expect(materialized).not.toContain('$SPOOL_WS')
    expect(materialized).toContain(`${resumerWs}/src/demo.ts`)
    const newSessionId = (files[0] as string).replace(/\.jsonl$/, '')
    for (const line of lines) {
      const parsed = JSON.parse(line) as { sessionId?: string }
      if (parsed.sessionId !== undefined) expect(parsed.sessionId).toBe(newSessionId)
    }
    const birth = JSON.parse(lines[4] as string) as {
      message: { content: [{ text: string }] }
      parentUuid: string
    }
    expect(birth.parentUuid).toBe('u-4')
    expect(birth.message.content[0].text).toContain('<spool-resume-note>')
    expect(logs.join('\n')).toContain(`claude --resume ${newSessionId} --fork-session`)

    // Default behavior hands off to the native CLI's fork entry point, in
    // the REAL workspace path even though a symlink was passed in.
    expect(spawnCalls).toEqual([
      { cmd: 'claude', args: ['--resume', newSessionId, '--fork-session'], cwd: resumerWs },
    ])
  })

  it('shares and resumes a codex session into ~/.codex/sessions with the native command', async () => {
    const hub = makeHub()
    const authorWs = mkdtempSync(join(tmpdir(), 'spool-codex-author-'))
    const authorHome = mkdtempSync(join(tmpdir(), 'spool-codex-author-home-'))
    const line = (record: Record<string, unknown>) => JSON.stringify(record)
    const jsonl =
      [
        line({
          timestamp: '2026-07-16T10:00:00Z',
          type: 'session_meta',
          payload: { id: 'orig-codex', cwd: authorWs },
        }),
        line({
          timestamp: '2026-07-16T10:00:01Z',
          type: 'turn_context',
          payload: { model: 'gpt-5-codex', cwd: authorWs },
        }),
        line({
          timestamp: '2026-07-16T10:00:02Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: `rename alpha to beta in ${authorWs}/src/demo.ts`,
          },
        }),
        line({
          timestamp: '2026-07-16T10:00:03Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: 'Done: renamed alpha to beta.' },
        }),
      ].join('\n') + '\n'
    const filePath = join(authorWs, 'rollout.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')
    const share = shareDeps(hub, authorWs, filePath, authorHome)

    const shareExit = await handleShareCommand(
      undefined,
      { agentSummary: false, visibilityConfirmed: true },
      {
        ...share.deps,
        resolveTarget: () => ({
          provider: 'codex' as const,
          sessionUuid: SESSION_UUID,
          filePath,
          cwd: authorWs,
        }),
      },
    )
    expect(share.errors).toEqual([])
    expect(shareExit).toBe(0)

    const sid = `codex_${SESSION_UUID}`
    expect(hub.sessions.get(sid)).toBeDefined()
    for (const oid of hub.sessions.get(sid)?.manifest ?? []) {
      expect(hub.objects.get(oid)).not.toContain(authorWs)
    }

    const resumerWs = realpathSync(mkdtempSync(join(tmpdir(), 'spool-codex-resumer-ws-')))
    const resumerHome = mkdtempSync(join(tmpdir(), 'spool-codex-resumer-home-'))
    const logs: string[] = []
    const errors: string[] = []
    const spawnCalls: Array<{ cmd: string; args: readonly string[]; cwd: unknown }> = []
    const fakeSpawn = ((cmd: string, args: readonly string[], opts: { cwd?: unknown }) => {
      spawnCalls.push({ cmd, args, cwd: opts.cwd })
      return { status: 0 }
    }) as unknown as typeof import('node:child_process').spawnSync
    const resumeExit = await handleResumeCommand(
      `${HUB_URL}/session/${sid}`,
      { workspace: resumerWs },
      {
        fetch: hub.fetchImpl,
        homeDir: resumerHome,
        env: {} as NodeJS.ProcessEnv,
        log: (message: string) => logs.push(message),
        error: (message: string) => errors.push(message),
        spawn: fakeSpawn,
      },
    )
    expect(errors).toEqual([])
    expect(resumeExit).toBe(0)

    // The rollout lands under the date-partitioned codex sessions tree.
    const sessionsRoot = join(resumerHome, '.codex', 'sessions')
    const files = (readdirSync(sessionsRoot, { recursive: true }) as string[]).filter((entry) =>
      entry.endsWith('.jsonl'),
    )
    expect(files).toHaveLength(1)
    const relPath = files[0] as string
    expect(relPath.split(sep)).toHaveLength(4) // YYYY/MM/DD/rollout-….jsonl
    const fileName = relPath.split(sep).at(-1) as string
    const nameMatch = fileName.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/)
    expect(nameMatch).not.toBeNull()
    const newSessionId = (nameMatch as RegExpMatchArray)[1] as string

    const materialized = readFileSync(join(sessionsRoot, relPath), 'utf8')
    const lines = materialized.trim().split('\n')
    expect(lines).toHaveLength(5)
    expect(materialized).not.toContain('$SPOOL_WS')
    expect(materialized).toContain(`${resumerWs}/src/demo.ts`)
    const meta = JSON.parse(lines[0] as string) as { payload: { id: string; cwd: string } }
    expect(meta.payload.id).toBe(newSessionId)
    expect(meta.payload.cwd).toBe(resumerWs)
    const birth = JSON.parse(lines[4] as string) as {
      type: string
      payload: { role: string; content: [{ type: string; text: string }] }
    }
    expect(birth.type).toBe('response_item')
    expect(birth.payload.content[0].text).toContain('<spool-resume-note>')

    expect(logs.join('\n')).toContain(`codex fork ${newSessionId}`)
    expect(spawnCalls).toEqual([{ cmd: 'codex', args: ['fork', newSessionId], cwd: resumerWs }])
  })

  it('attaches a .spool document when --spool-file is given', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-attach-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-attach-home-'))
    const filePath = writeFixtureSession(ws)
    const docPath = join(ws, 'doc.spool')
    writeFileSync(
      docPath,
      JSON.stringify({
        version: 2,
        exportedAt: '2026-07-16T12:00:00.000Z',
        conversation: { title: 'curated doc', turns: [{ role: 'user', body: 'hi' }] },
        opts: { template: 'letter' },
      }),
      'utf8',
    )
    const share = shareDeps(hub, ws, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, spoolFile: docPath, visibilityConfirmed: true },
      share.deps,
    )
    expect(share.errors).toEqual([])
    expect(exit).toBe(0)

    const head = hub.sessions.get(`claude_${SESSION_UUID}`)
    expect(head?.spoolFileOid).toBeTruthy()
    expect(hub.objects.get(head?.spoolFileOid ?? '')).toContain('curated doc')
  })

  it('rejects a malformed --spool-file before touching the hub', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-attach-bad-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-attach-bad-home-'))
    const filePath = writeFixtureSession(ws)
    const docPath = join(ws, 'not-a-doc.spool')
    writeFileSync(docPath, '{"nope":true}', 'utf8')
    const share = shareDeps(hub, ws, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, spoolFile: docPath, visibilityConfirmed: true },
      share.deps,
    )
    expect(exit).toBe(1)
    expect(share.errors.join('\n')).toContain('unrecognized shape')
    expect(hub.sessions.size).toBe(0)
  })

  it('aborts the share when the redact gate finds secrets and the user declines', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-secret-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-secret-home-'))
    const jsonl =
      JSON.stringify({
        type: 'user',
        uuid: 'u-1',
        sessionId: 'orig',
        message: { role: 'user', content: 'my key is AKIAABCDEFGHIJKLMNOP and secret stuff' },
      }) + '\n'
    const filePath = join(ws, 'session.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')
    const share = shareDeps(hub, ws, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false },
      {
        ...share.deps,
        confirm: async () => false,
      },
    )
    expect(exit).toBe(1)
    expect(share.errors.join('\n')).toContain('Share cancelled')
    expect(hub.sessions.size).toBe(0)
    expect(share.logs.join('\n')).toContain('high-severity')
  })

  it('still requires secret approval after an enclosing visibility confirmation', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-secret-list-flow-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-secret-list-flow-home-'))
    const jsonl =
      JSON.stringify({
        type: 'user',
        uuid: 'u-1',
        sessionId: 'orig',
        message: { role: 'user', content: 'my key is AKIAABCDEFGHIJKLMNOP' },
      }) + '\n'
    const filePath = join(ws, 'session.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')
    const share = shareDeps(hub, ws, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, visibilityConfirmed: true },
      { ...share.deps, confirm: async () => false },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.size).toBe(0)
  })

  it('defaults the secret-finding confirmation to yes', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-secret-default-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-secret-default-home-'))
    const jsonl =
      JSON.stringify({
        type: 'user',
        uuid: 'u-1',
        sessionId: 'orig',
        message: { role: 'user', content: 'my key is AKIAABCDEFGHIJKLMNOP and secret stuff' },
      }) + '\n'
    const filePath = join(ws, 'session.jsonl')
    writeFileSync(filePath, jsonl, 'utf8')
    const share = shareDeps(hub, ws, filePath, home)
    const events: string[] = []

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false },
      {
        ...share.deps,
        ui: interactiveUi({ events }),
      },
    )

    expect(exit).toBe(0)
    expect(events).toContain('confirm:Share despite the secret findings?:yes')
    expect(hub.sessions.size).toBe(1)
  })

  it('fails resume when a record does not match its oid', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-tamper-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-tamper-home-'))
    const filePath = writeFixtureSession(ws)
    const share = shareDeps(hub, ws, filePath, home)
    expect(
      await handleShareCommand(
        undefined,
        { agentSummary: false, visibilityConfirmed: true },
        share.deps,
      ),
    ).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    const head = hub.sessions.get(sid) as StoredHead
    hub.objects.set(head.manifest[0] as string, '{"tampered":true}')

    const errors: string[] = []
    const exit = await handleResumeCommand(
      `${HUB_URL}/session/${sid}`,
      { workspace: ws },
      {
        fetch: hub.fetchImpl,
        homeDir: home,
        env: {} as NodeJS.ProcessEnv,
        log: () => {},
        error: (message: string) => errors.push(message),
      },
    )
    expect(exit).toBe(1)
    expect(errors.join('\n')).toContain('Integrity check failed')
  })

  it('reports a withdrawn session distinctly on resume', async () => {
    const hub = makeHub()
    const ws = mkdtempSync(join(tmpdir(), 'spool-gone-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-gone-home-'))
    const filePath = writeFixtureSession(ws)
    const share = shareDeps(hub, ws, filePath, home)
    expect(
      await handleShareCommand(
        undefined,
        { agentSummary: false, visibilityConfirmed: true },
        share.deps,
      ),
    ).toBe(0)

    const sid = `claude_${SESSION_UUID}`
    ;(hub.sessions.get(sid) as StoredHead).withdrawn = true
    const errors: string[] = []
    const exit = await handleResumeCommand(
      `${HUB_URL}/session/${sid}`,
      { workspace: ws },
      {
        fetch: hub.fetchImpl,
        homeDir: home,
        env: {} as NodeJS.ProcessEnv,
        log: () => {},
        error: (message: string) => errors.push(message),
      },
    )
    expect(exit).toBe(1)
    expect(errors.join('\n')).toContain('withdrawn')
  })
})

describe('default share target', () => {
  it('matches a provider cwd written through a filesystem symlink', () => {
    const base = mkdtempSync(join(tmpdir(), 'spool-share-cwd-'))
    const realWorkspace = join(base, 'workspace')
    const linkedWorkspace = join(base, 'workspace-link')
    mkdirSync(realWorkspace)
    symlinkSync(realWorkspace, linkedWorkspace, 'dir')

    const db = new Database(':memory:')
    try {
      db.exec('CREATE TABLE sessions (session_uuid TEXT, cwd TEXT, ended_at TEXT)')
      db.prepare('INSERT INTO sessions (session_uuid, cwd, ended_at) VALUES (?,?,?)').run(
        SESSION_UUID,
        linkedWorkspace,
        '2026-07-19T12:00:00.000Z',
      )

      expect(
        latestSessionUuidFor(
          db as ReturnType<typeof import('@spool-lab/core').getDB>,
          realWorkspace,
        ),
      ).toBe(SESSION_UUID)
    } finally {
      db.close()
      rmSync(base, { recursive: true, force: true })
    }
  })
})

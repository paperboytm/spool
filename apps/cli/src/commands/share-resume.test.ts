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

import {
  parseSummaryFrontMatter,
  sequenceRoot,
  serializePortableSession,
} from '@spool-lab/session-kit'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vite-plus/test'

import type { HubFetch, HubProject } from '../hub/client.js'
import type { LocalSummaryAgent } from '../hub/local-summary-agent.js'
import { upsertProjectBinding } from '../hub/project-bindings.js'
import type { CliSpinner, CliUi } from '../ui.js'
import { handleResumeCommand } from './resume.js'
import {
  bilingualSummaryValidationError,
  handleShareCommand,
  latestSessionUuidFor,
} from './share.js'

// Command-level round trip against an in-memory hub that implements the
// same wire contract as the backend. `spool share` seeds it, then
// `spool resume` materializes from it into a temp HOME.

const SESSION_UUID = '6f9a1b2c-3d4e-5f60-8a9b-0c1d2e3f4a5b'
const HUB_URL = 'https://hub.test'
const ACTOR_ID = 'user_00000001'
const HUB_PROJECT: HubProject = {
  id: 'project_spool0001',
  slug: 'spool',
  name: 'Spool',
  description: null,
  github_url: 'https://github.com/paperboytm/spool',
  owner: { kind: 'user', id: ACTOR_ID, handle: 'author', name: 'Author' },
  can_manage: true,
}
const TEAM_ID = 'team_00000001'
const TEAM_PROJECT: HubProject = {
  ...HUB_PROJECT,
  id: 'project_paperboy01',
  slug: 'react-vapor',
  name: 'React Vapor',
  owner: { kind: 'team', id: TEAM_ID, handle: 'paperboy', name: 'Paperboy' },
}
const BILINGUAL_SUMMARY = [
  '---',
  'title: Rename alpha to beta',
  'title_zh: 将 alpha 重命名为 beta',
  '---',
  '',
  '<!-- spool:summary:en -->',
  'The demo now uses the requested beta name.',
  '<!-- /spool:summary -->',
  '',
  '<!-- spool:summary:zh -->',
  '演示项目现在使用要求的 beta 名称。',
  '<!-- /spool:summary -->',
].join('\n')

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
  projectId: string
  expectedProjectId?: string | null
  visibility?: 'public' | 'link-only' | 'team'
  teamId?: string
  expectedTeamId?: string | null
  withdrawn?: boolean
}

function makeHub() {
  const objects = new Map<string, string>()
  const sessions = new Map<string, StoredHead>()
  const writes: Array<{ action: 'push' | 'head'; sid: string; body: StoredHead }> = []
  const projectCreates: Array<{ name: string; owner: { kind: 'user' | 'team'; id: string } }> = []

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
      /^\/api\/hub\/v1\/sessions\/([^/]+)(?:\/(push|head|records|view|withdraw|resume-grant))?$/,
    )

    if (method === 'GET' && path === '/api/hub/v1/projects') {
      return json({ actor: { id: ACTOR_ID }, projects: [HUB_PROJECT, TEAM_PROJECT] })
    }

    if (method === 'POST' && path === '/api/hub/v1/projects') {
      const body = JSON.parse(String(init?.body)) as {
        name: string
        owner: { kind: 'user' | 'team'; id: string }
      }
      projectCreates.push(body)
      const owner =
        body.owner.kind === 'team'
          ? { kind: 'team' as const, id: body.owner.id, handle: 'paperboy', name: 'Paperboy' }
          : { kind: 'user' as const, id: body.owner.id, handle: 'author', name: 'Author' }
      return json({
        project: {
          ...HUB_PROJECT,
          id: `project_created${String(projectCreates.length).padStart(4, '0')}`,
          slug: body.name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-'),
          name: body.name,
          owner,
        },
      })
    }

    if (method === 'GET' && path === '/api/hub/v1/teams') {
      return json({
        teams: [
          {
            id: TEAM_ID,
            name: 'Paperboy',
            handle: 'paperboy',
            role: 'owner',
            permissions: [],
            member_count: 1,
            archived_at: null,
          },
        ],
      })
    }

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
        writes.push({ action, sid, body })
        if (
          body.expectedProjectId !== undefined &&
          (sessions.get(sid)?.projectId ?? null) !== body.expectedProjectId
        ) {
          return json({ error: 'CONFLICT', detail: 'Project changed' }, 409)
        }
        if (
          body.expectedTeamId !== undefined &&
          (sessions.get(sid)?.teamId ?? null) !== body.expectedTeamId
        ) {
          return json({ error: 'CONFLICT', detail: 'Team changed' }, 409)
        }
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
          visibility: session.visibility ?? 'public',
          team: session.teamId === TEAM_ID ? { id: TEAM_ID, name: 'Paperboy' } : null,
          project:
            session.projectId === HUB_PROJECT.id
              ? HUB_PROJECT
              : session.projectId === TEAM_PROJECT.id
                ? TEAM_PROJECT
                : null,
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
      if (method === 'POST' && action === 'resume-grant') {
        const body = JSON.parse(String(init?.body)) as { position: number }
        return json({ version: 1, token: `grant:${sid}:${body.position}` })
      }
    }
    return json({ error: 'NOT_FOUND', detail: `unhandled ${method} ${path}` }, 404)
  }

  return { fetchImpl, objects, sessions, writes, projectCreates }
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
    projectChoice?: 'create'
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
    select: async ({ message, choices }) => {
      events.push(`select:${message}`)
      if (options.projectChoice === 'create' && message.startsWith('Which Hub Project')) {
        return choices.find((choice) => choice.label.startsWith('Create Project'))?.value ?? null
      }
      const wanted = options.selected ?? 'claude'
      return choices.find((choice) => choice.value === wanted)?.value ?? choices[0]?.value ?? null
    },
    autocomplete: async ({ message, choices }) => {
      events.push(`autocomplete:${message}`)
      return choices[0]?.value ?? null
    },
    spinner,
  }
}

function shareDeps(
  hub: ReturnType<typeof makeHub>,
  workspaceRoot: string,
  filePath: string,
  home: string,
  options: { bindProject?: boolean } = {},
) {
  const logs: string[] = []
  const errors: string[] = []
  const projectIdentity = {
    kind: 'git_remote' as const,
    key: 'github.com/paperboytm/spool',
    displayName: 'spool',
  }
  if (options.bindProject !== false) {
    upsertProjectBinding(
      {
        hubUrl: HUB_URL,
        actorId: ACTOR_ID,
        tenant: { kind: 'user', id: ACTOR_ID },
        localIdentity: projectIdentity,
        project: HUB_PROJECT,
      },
      { homeDir: home },
    )
  }
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
        projectIdentity,
      }),
    },
  }
}

describe('spool share local Agent Summary flow', () => {
  it('rejects overlong titles and repeated title headings before upload', () => {
    expect(
      bilingualSummaryValidationError(
        BILINGUAL_SUMMARY.replace('title: Rename alpha to beta', `title: ${'a'.repeat(97)}`),
      ),
    ).toMatch(/at most 96 characters/)
    expect(
      bilingualSummaryValidationError(
        BILINGUAL_SUMMARY.replace(
          '<!-- spool:summary:en -->\n',
          '<!-- spool:summary:en -->\n# Rename alpha to beta\n\n',
        ),
      ),
    ).toMatch(/must not repeat the Session title/)
  })

  it('checks long closing heading sequences without regex backtracking', () => {
    const repeatedHeading = `# Rename alpha to beta${' '.repeat(32 * 1024)}###`
    expect(
      bilingualSummaryValidationError(
        BILINGUAL_SUMMARY.replace(
          '<!-- spool:summary:en -->\n',
          `<!-- spool:summary:en -->\n${repeatedHeading}\n\n`,
        ),
      ),
    ).toMatch(/must not repeat the Session title/)

    const distinctHeading = `# Explain the change${' '.repeat(32 * 1024)}###`
    expect(
      bilingualSummaryValidationError(
        BILINGUAL_SUMMARY.replace(
          '<!-- spool:summary:en -->\n',
          `<!-- spool:summary:en -->\n${distinctHeading}\n\n`,
        ),
      ),
    ).toBeNull()

    const unclosedHeading = `# Explain the change${' '.repeat(32 * 1024)}x`
    expect(
      bilingualSummaryValidationError(
        BILINGUAL_SUMMARY.replace(
          '<!-- spool:summary:en -->\n',
          `<!-- spool:summary:en -->\n${unclosedHeading}\n\n`,
        ),
      ),
    ).toBeNull()
  })

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
              projectIdentity: {
                kind: 'path',
                key: '/tmp/example',
                displayName: 'example',
              },
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

  it('keeps legacy manual Summary Markdown source-compatible', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-manual-legacy-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-manual-legacy-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const summary = '## Outcome\n\nUploaded exactly by an existing automation.'

    const exit = await handleShareCommand(
      undefined,
      { summary, visibilityConfirmed: true },
      share.deps,
    )

    expect(exit).toBe(0)
    expect(share.errors).toEqual([])
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(summary)
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
      'confirm:Publish this Session as Public in Project Spool? It can appear in Explore and search.:yes',
    )
    expect(
      events.indexOf(
        'confirm:Publish this Session as Public in Project Spool? It can appear in Explore and search.:yes',
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
          return BILINGUAL_SUMMARY
        },
      },
    )

    expect(exit).toBe(0)
    expect(generatedAfterUpload).toBe(true)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(BILINGUAL_SUMMARY)
    expect(events.findIndex((event) => event.startsWith('note:Public Session URL:'))).toBeLessThan(
      events.findIndex((event) => event.startsWith('confirm:Generate a Summary')),
    )
    expect(events).toContain('select:Which local Agent should generate the Summary?')
  })

  it('uploads a Summary whose only defect is an overlong title', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-long-title-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-long-title-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    const overlong = `Rename alpha to beta across the demo workspace ${'and every downstream caller '.repeat(4)}`

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      {},
      {
        ...share.deps,
        ui: interactiveUi({ selected: 'claude', events }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
        generateSummary: async () =>
          BILINGUAL_SUMMARY.replace('title: Rename alpha to beta', `title: ${overlong}`),
      },
    )

    expect(exit).toBe(0)
    const stored = hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd as string
    const titles = parseSummaryFrontMatter(stored).titles
    expect(Array.from(titles?.en ?? '').length).toBeLessThanOrEqual(96)
    expect(titles?.en).toMatch(/^Rename alpha to beta across the demo workspace .*…$/)
    expect(titles?.zh).toBe('将 alpha 重命名为 beta')
    expect(stored).toContain('The demo now uses the requested beta name.')
    expect(events).toContain('info:Shortened `title` to the 96-character Session title limit.')
    expect(events.some((event) => event.startsWith('spinner:error:'))).toBe(false)
  })

  it('rejects an Agent Summary that exceeded 64 KiB before title repair', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-too-large-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-too-large-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    const generated = BILINGUAL_SUMMARY.replace(
      'title: Rename alpha to beta',
      `title: ${'a'.repeat(64 * 1024)}`,
    )

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      {},
      {
        ...share.deps,
        ui: interactiveUi({ selected: 'claude', events }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
        generateSummary: async () => generated,
      },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
    expect(events).toContain(
      'error:Claude Code returned an invalid bilingual Summary: the UTF-8 document exceeds 64 KiB',
    )
  })

  it('rejects a repeated first H1 even when its overlong title is repaired', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-repeated-long-title-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-repeated-long-title-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    const overlong = `Rename alpha to beta across the demo workspace ${'and every downstream caller '.repeat(4)}`
    const generated = BILINGUAL_SUMMARY.replace(
      'title: Rename alpha to beta',
      `title: ${overlong}`,
    ).replace('<!-- spool:summary:en -->\n', `<!-- spool:summary:en -->\n# ${overlong}\n\n`)

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      {},
      {
        ...share.deps,
        ui: interactiveUi({ selected: 'claude', events }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
        generateSummary: async () => generated,
      },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
    expect(events).toContain(
      'error:Claude Code returned an invalid bilingual Summary: Summary bodies must not repeat the Session title as their first H1',
    )
  })

  it('rejects a first H1 that repeats the repaired Session title', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-summary-repeated-repaired-title-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-summary-repeated-repaired-title-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []
    const overlong = 'a'.repeat(120)
    const repairedTitle = `${'a'.repeat(95)}…`
    const generated = BILINGUAL_SUMMARY.replace(
      'title: Rename alpha to beta',
      `title: ${overlong}`,
    ).replace('<!-- spool:summary:en -->\n', `<!-- spool:summary:en -->\n# ${repairedTitle}\n\n`)

    const exit = await handleShareCommand(
      `${SESSION_UUID}@2`,
      {},
      {
        ...share.deps,
        ui: interactiveUi({ selected: 'claude', events }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
        generateSummary: async () => generated,
      },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
    expect(events).toContain(
      'error:Claude Code returned an invalid bilingual Summary: Summary bodies must not repeat the Session title as their first H1',
    )
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
      'This Session will be Public in Project Spool and can appear in Explore and search.',
    )
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBeNull()
  })

  it('fails closed without an explicit or saved Project in non-interactive mode', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-project-nontty-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-project-nontty-home-'))
    const filePath = writeFixtureSession(workspace)
    const logs: string[] = []
    const errors: string[] = []

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, visibilityConfirmed: true, yes: true },
      {
        fetch: hub.fetchImpl,
        homeDir: home,
        env: { SPOOL_HUB_URL: HUB_URL, SPOOL_HUB_TOKEN: 'test-token' },
        cwd: workspace,
        log: (message) => logs.push(message),
        error: (message) => errors.push(message),
        resolveTarget: () => ({
          provider: 'claude',
          sessionUuid: SESSION_UUID,
          filePath,
          cwd: workspace,
          projectIdentity: {
            kind: 'git_remote',
            key: 'github.com/paperboytm/unbound',
            displayName: 'unbound',
          },
        }),
      },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.size).toBe(0)
    expect(errors.join('\n')).toContain('--yes` never chooses a Project')
  })

  it('publishes directly to a Team Project without creating a Public head', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-team-share-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-team-share-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {
        agentSummary: false,
        summary: BILINGUAL_SUMMARY,
        team: '@paperboy',
        project: TEAM_PROJECT.id,
        visibilityConfirmed: true,
        yes: true,
      },
      share.deps,
    )

    expect(exit).toBe(0)
    const writes = hub.writes.filter((write) => write.sid === `claude_${SESSION_UUID}`)
    expect(writes).not.toHaveLength(0)
    expect(writes.every((write) => write.body.visibility === 'team')).toBe(true)
    expect(writes.every((write) => write.body.teamId === TEAM_ID)).toBe(true)
    expect(writes.every((write) => write.body.projectId === TEAM_PROJECT.id)).toBe(true)
    expect(
      writes.filter((write) => write.action === 'head').map((write) => write.body.expectedTeamId),
    ).toEqual([null, TEAM_ID])
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'team',
      teamId: TEAM_ID,
      projectId: TEAM_PROJECT.id,
    })
    expect(share.logs.join('\n')).toContain('Only current members')
  })

  it('publishes a Team-owned Project as Public when explicitly requested', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-team-public-share-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-team-public-share-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {
        agentSummary: false,
        team: '@paperboy',
        public: true,
        project: 'paperboy/react-vapor',
        visibilityConfirmed: true,
        yes: true,
      },
      share.deps,
    )

    expect(exit).toBe(0)
    const writes = hub.writes.filter((write) => write.sid === `claude_${SESSION_UUID}`)
    expect(writes).not.toHaveLength(0)
    expect(writes.every((write) => write.body.visibility === 'public')).toBe(true)
    expect(writes.every((write) => write.body.teamId === TEAM_ID)).toBe(true)
    expect(writes.every((write) => write.body.projectId === TEAM_PROJECT.id)).toBe(true)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'public',
      teamId: TEAM_ID,
      projectId: TEAM_PROJECT.id,
    })
    expect(share.logs.join('\n')).toContain('Team · Paperboy owns the hosted Session')
  })

  it('derives Team ownership from --project without requiring --team', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-project-owner-share-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-project-owner-share-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {
        agentSummary: false,
        public: true,
        project: 'paperboy/react-vapor',
        visibilityConfirmed: true,
        yes: true,
      },
      share.deps,
    )

    expect(exit).toBe(0)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'public',
      teamId: TEAM_ID,
      projectId: TEAM_PROJECT.id,
    })
  })

  it('keeps Team ownership for an explicit Link-only share', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-team-link-share-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-team-link-share-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {
        agentSummary: false,
        linkOnly: true,
        project: 'paperboy/react-vapor',
        visibilityConfirmed: true,
        yes: true,
      },
      share.deps,
    )

    expect(exit).toBe(0)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'link-only',
      teamId: TEAM_ID,
      projectId: TEAM_PROJECT.id,
    })
  })

  it('rejects a Project whose owner conflicts with --team', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-team-project-mismatch-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-team-project-mismatch-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      {
        agentSummary: false,
        team: '@paperboy',
        public: true,
        project: HUB_PROJECT.id,
        visibilityConfirmed: true,
        yes: true,
      },
      share.deps,
    )

    expect(exit).toBe(1)
    expect(hub.sessions.size).toBe(0)
    expect(share.errors.join('\n')).toContain('different owner')
  })

  it('still asks an interactive Team share to select a Project when --yes is set', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-team-project-select-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-team-project-select-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)
    const events: string[] = []

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, team: 'paperboy', visibilityConfirmed: true, yes: true },
      { ...share.deps, ui: interactiveUi({ events }) },
    )

    expect(exit).toBe(0)
    expect(events.join('\n')).toContain('select:Which Hub Project should "spool" publish to?')
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)).toMatchObject({
      visibility: 'team',
      teamId: TEAM_ID,
      projectId: TEAM_PROJECT.id,
    })
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

  it('does not create a Project before the user accepts the disclosure', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-project-before-disclosure-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-project-before-disclosure-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home)

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false, createProject: 'Should not exist' },
      {
        ...share.deps,
        ui: interactiveUi({ confirm: false }),
      },
    )

    expect(exit).toBe(1)
    expect(hub.sessions.size).toBe(0)
    expect(hub.writes).toEqual([])
  })

  it('offers interactive Project creation but does not write when disclosure is declined', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-project-create-declined-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-project-create-declined-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home, { bindProject: false })
    const events: string[] = []

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false },
      {
        ...share.deps,
        ui: interactiveUi({ projectChoice: 'create', confirm: false, events }),
      },
    )

    expect(exit).toBe(1)
    expect(events.join('\n')).toContain('select:Which Hub Project should "spool" publish to?')
    expect(hub.projectCreates).toEqual([])
    expect(hub.sessions.size).toBe(0)
    expect(hub.writes).toEqual([])
  })

  it('creates the selected Project only after disclosure is accepted, then publishes to it', async () => {
    const hub = makeHub()
    const workspace = mkdtempSync(join(tmpdir(), 'spool-project-create-accepted-'))
    const home = mkdtempSync(join(tmpdir(), 'spool-project-create-accepted-home-'))
    const filePath = writeFixtureSession(workspace)
    const share = shareDeps(hub, workspace, filePath, home, { bindProject: false })

    const exit = await handleShareCommand(
      undefined,
      { agentSummary: false },
      {
        ...share.deps,
        ui: interactiveUi({ projectChoice: 'create', confirm: true }),
      },
    )

    expect(exit).toBe(0)
    expect(hub.projectCreates).toHaveLength(1)
    expect(hub.projectCreates[0]).toMatchObject({
      name: 'spool',
      owner: { kind: 'user', id: ACTOR_ID },
    })
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.projectId).toBe('project_created0001')
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
        { summary: BILINGUAL_SUMMARY, visibilityConfirmed: true },
        share.deps,
      ),
    ).toBe(0)

    const exit = await handleShareCommand(
      undefined,
      {},
      {
        ...share.deps,
        ui: interactiveUi({
          confirm: (message) => message.startsWith('Publish this Session as Public'),
        }),
        detectSummaryAgents: async () => [
          { id: 'claude', name: 'Claude Code', path: '/bin/claude' },
        ],
      },
    )

    expect(exit).toBe(0)
    expect(hub.sessions.get(`claude_${SESSION_UUID}`)?.summaryMd).toBe(BILINGUAL_SUMMARY)
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
          confirm: (message) => message.startsWith('Publish this Session as Public'),
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
  it.each(['gemini', 'opencode', 'pi', 'zcode'] as const)(
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
        {
          agentSummary: false,
          visibilityConfirmed: true,
          project: HUB_PROJECT.id,
        },
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
            projectIdentity: {
              kind: 'git_remote',
              key: 'github.com/paperboytm/spool',
              displayName: 'spool',
            },
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

    const summary = BILINGUAL_SUMMARY
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
    expect(head?.projectId).toBe(HUB_PROJECT.id)
    expect(hub.writes).not.toHaveLength(0)
    expect(new Set(hub.writes.map((write) => write.body.projectId))).toEqual(
      new Set([HUB_PROJECT.id]),
    )
    expect(
      hub.writes
        .filter((write) => write.action === 'head')
        .map((write) => write.body.expectedProjectId),
    ).toEqual([null, HUB_PROJECT.id])
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
    expect(birth.message.content[0].text).toContain(`"proof":"grant:${sid}:4"`)
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
          projectIdentity: {
            kind: 'git_remote',
            key: 'github.com/paperboytm/spool',
            displayName: 'spool',
          },
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
    expect(birth.payload.content[0].text).toContain(`"proof":"grant:${sid}:4"`)

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

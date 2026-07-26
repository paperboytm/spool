import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { HubProject, HubTeam } from '../hub/client.js'
import { createTextUi } from '../ui.js'
import { handleVisibilityCommand } from './visibility.js'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-visibility-'))
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

const LOGGED_IN = { SPOOL_HUB_URL: 'https://hub.test', SPOOL_HUB_TOKEN: 'test-token' }
const TEAMS: HubTeam[] = [
  {
    id: 'team_00000001',
    name: 'Paperboy',
    handle: 'paperboy',
    role: 'admin',
    permissions: [],
    member_count: 3,
    archived_at: null,
  },
]
const PERSONAL_PROJECT: HubProject = {
  id: 'project_personal01',
  slug: 'spool',
  name: 'Spool',
  description: null,
  github_url: null,
  owner: { kind: 'user', id: 'user_00000001', handle: 'evan', name: 'Evan' },
  can_manage: true,
}
const TEAM_PROJECT: HubProject = {
  ...PERSONAL_PROJECT,
  id: 'project_team000001',
  slug: 'paperboy',
  name: 'Paperboy',
  owner: { kind: 'team', id: 'team_00000001', handle: 'paperboy', name: 'Paperboy' },
}

function patchResponder(
  session: Record<string, unknown>,
): (url: unknown, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const path = new URL(String(url)).pathname
    if (init?.method === 'GET' && path === '/api/hub/v1/sessions/claude_abc12345') {
      return Response.json({
        sid: 'claude_abc12345',
        root: 'root',
        count: 1,
        sig: null,
        cardJson: null,
        summaryMd: null,
        lineageJson: null,
        viewOid: 'view',
        createdAt: 1,
        updatedAt: 1,
        project: PERSONAL_PROJECT,
        author: { handle: 'evan', displayName: 'Evan', avatarUrl: null },
      })
    }
    if (init?.method === 'GET' && path === '/api/hub/v1/projects') {
      return Response.json({
        actor: { id: 'user_00000001' },
        projects: [PERSONAL_PROJECT, TEAM_PROJECT],
      })
    }
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({ session }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    throw new Error(`Unexpected request: ${String(url)}`)
  }
}

describe('visibility command', () => {
  it('rejects unknown targets', async () => {
    const { ui, errors } = capturingUi()
    expect(
      await handleVisibilityCommand('claude_abc12345', 'secret', {}, { ui, homeDir: tempHome() }),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Unknown visibility')
  })

  it('requires login', async () => {
    const { ui, errors } = capturingUi()
    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'public',
        { yes: true },
        { ui, homeDir: tempHome(), env: {} },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Not logged in')
  })

  it('requires a confirmation path without a TTY', async () => {
    const { ui, errors } = capturingUi()
    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'public',
        {},
        { ui, homeDir: tempHome(), env: LOGGED_IN },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('--yes')
  })

  it('promotes a Team session to Public via the management PATCH', async () => {
    const { ui, output } = capturingUi()
    const fetch = vi.fn(
      patchResponder({
        sid: 'claude_abc12345',
        visibility: 'public',
        team_id: 'team_00000001',
        team_name: 'Paperboy',
      }),
    )

    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'public',
        { yes: true },
        { ui, homeDir: tempHome(), env: LOGGED_IN, fetch: fetch as never },
      ),
    ).toBe(0)

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('https://hub.test/api/me/sessions/claude_abc12345')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({ visibility: 'public' })
    expect(output.join('\n')).toContain('now Public')
  })

  it('moves a session to a Team chosen by name', async () => {
    const { ui, output } = capturingUi()
    const fetch = vi.fn(
      patchResponder({
        sid: 'claude_abc12345',
        visibility: 'team',
        team_id: 'team_00000001',
        team_name: 'Paperboy',
      }),
    )

    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'team',
        { team: '@paperboy', project: TEAM_PROJECT.id, yes: true },
        {
          ui,
          homeDir: tempHome(),
          env: LOGGED_IN,
          fetch: fetch as never,
          listTeams: async () => TEAMS,
        },
      ),
    ).toBe(0)

    const [, init] = fetch.mock.calls.find((call) => call[1]?.method === 'PATCH') as [
      string,
      RequestInit,
    ]
    expect(JSON.parse(String(init.body))).toEqual({
      visibility: 'team',
      team_id: 'team_00000001',
      project_id: TEAM_PROJECT.id,
      expected_project_id: PERSONAL_PROJECT.id,
    })
    expect(output.join('\n')).toContain('Team · Paperboy only')
  })

  it('rejects an ambiguous Team display name before creating or transferring', async () => {
    const { ui, errors } = capturingUi()
    const fetch = vi.fn(
      patchResponder({
        sid: 'claude_abc12345',
        visibility: 'team',
        team_id: 'team_a',
        team_name: 'Shared',
      }),
    )
    const duplicateTeams: HubTeam[] = [
      { ...TEAMS[0]!, id: 'team_a', name: 'Shared', handle: 'shared-a' },
      { ...TEAMS[0]!, id: 'team_b', name: 'Shared', handle: 'shared-b' },
    ]

    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'team',
        { team: 'Shared', createProject: 'Project', yes: true },
        {
          ui,
          homeDir: tempHome(),
          env: LOGGED_IN,
          fetch: fetch as never,
          listTeams: async () => duplicateTeams,
        },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('More than one Team is named "Shared"')
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false)
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false)
  })

  it('explains a 403 as a Team role problem', async () => {
    const { ui, errors } = capturingUi()
    const fetch = vi.fn(async () => new Response('forbidden', { status: 403 }))

    expect(
      await handleVisibilityCommand(
        'claude_abc12345',
        'link-only',
        { yes: true },
        { ui, homeDir: tempHome(), env: LOGGED_IN, fetch: fetch as never },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Owners or Admins')
  })
})

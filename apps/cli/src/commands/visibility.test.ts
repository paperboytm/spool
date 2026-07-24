import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { HubTeam } from '../hub/client.js'
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
    role: 'admin',
    permissions: [],
    member_count: 3,
    archived_at: null,
  },
]

function patchResponder(
  session: Record<string, unknown>,
): (url: unknown, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
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
        { team: 'Paperboy', yes: true },
        {
          ui,
          homeDir: tempHome(),
          env: LOGGED_IN,
          fetch: fetch as never,
          listTeams: async () => TEAMS,
        },
      ),
    ).toBe(0)

    const [, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      visibility: 'team',
      team_id: 'team_00000001',
    })
    expect(output.join('\n')).toContain('Team · Paperboy only')
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

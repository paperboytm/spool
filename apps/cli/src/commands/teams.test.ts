import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { HubTeam } from '../hub/client.js'
import { createTextUi } from '../ui.js'
import { handleTeamsCommand } from './teams.js'

const dirs: string[] = []

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spool-teams-'))
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
    role: 'owner',
    permissions: [],
    member_count: 3,
    archived_at: null,
  },
  {
    id: 'team_00000002',
    name: 'Weekend Hacks',
    handle: 'weekend-hacks',
    role: 'member',
    permissions: [],
    member_count: 1,
    archived_at: null,
  },
]

describe('teams command', () => {
  it('requires login', async () => {
    const { ui, errors } = capturingUi()
    expect(await handleTeamsCommand({}, { ui, homeDir: tempHome(), env: {} })).toBe(1)
    expect(errors.join('\n')).toContain('Not logged in')
  })

  it('lists teams with stable handles, role, and member count', async () => {
    const { ui, output } = capturingUi()
    expect(
      await handleTeamsCommand(
        {},
        { ui, homeDir: tempHome(), env: LOGGED_IN, listTeams: async () => TEAMS },
      ),
    ).toBe(0)
    const text = output.join('\n')
    expect(text).toContain('Team · Paperboy  @paperboy  (owner, 3 members)')
    expect(text).toContain('Team · Weekend Hacks  @weekend-hacks  (member, 1 member)')
    expect(text).toContain('subscribe --team <handle>')
    expect(text).toContain('share --team <handle>')
  })

  it('reports an empty membership', async () => {
    const { ui, output } = capturingUi()
    expect(
      await handleTeamsCommand(
        {},
        { ui, homeDir: tempHome(), env: LOGGED_IN, listTeams: async () => [] },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('not a member of any Team')
  })

  it('outputs JSON', async () => {
    const { ui } = capturingUi()
    const lines: string[] = []
    expect(
      await handleTeamsCommand(
        { json: true },
        {
          ui,
          log: (message) => lines.push(message),
          homeDir: tempHome(),
          env: LOGGED_IN,
          listTeams: async () => TEAMS,
        },
      ),
    ).toBe(0)
    const parsed = JSON.parse(lines.join('\n')) as HubTeam[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0]?.name).toBe('Paperboy')
  })
})

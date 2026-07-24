import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { HubTeam } from '../hub/client.js'
import { loadSubscriptions } from '../subscriptions.js'
import { createTextUi } from '../ui.js'
import {
  handleSubscribeCommand,
  handleSubscriptionsCommand,
  handleUnsubscribeCommand,
} from './subscribe.js'

const dirs: string[] = []

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
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

const TEAMS: HubTeam[] = [
  {
    id: 'team_00000001',
    name: 'Paperboy',
    role: 'member',
    permissions: [],
    member_count: 3,
    archived_at: null,
  },
]

describe('subscribe command', () => {
  it('requires an explicit disclosure choice without a TTY', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(project, { yes: true }, { ui, homeDir: home, cwd: project }),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Choose a disclosure')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('rejects conflicting disclosure flags', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { linkOnly: true, public: true, yes: true },
        { ui, homeDir: home, cwd: project },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('exactly one')
  })

  it('subscribes Link-only with --link-only --yes and discloses the outcome', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        undefined,
        { linkOnly: true, yes: true },
        { ui, homeDir: home, cwd: project, now: () => '2026-07-24T00:00:00.000Z' },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('Link-only')
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      { path: project, visibility: 'link-only', addedAt: '2026-07-24T00:00:00.000Z' },
    ])
  })

  it('subscribes to a Team by name and stores id and name', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { team: 'Paperboy', yes: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => TEAMS,
          now: () => '2026-07-24T00:00:00.000Z',
        },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('Team · Paperboy')
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      {
        path: project,
        visibility: 'team',
        teamId: 'team_00000001',
        teamName: 'Paperboy',
        addedAt: '2026-07-24T00:00:00.000Z',
      },
    ])
  })

  it('rejects an unknown Team and names the available ones', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { team: 'Nope', yes: true },
        { ui, homeDir: home, cwd: project, listTeams: async () => TEAMS },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Paperboy')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('subscribes Public only as an explicit opt-in and lists it', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { public: true, yes: true },
        { ui, homeDir: home, cwd: project },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]?.visibility).toBe('public')

    expect(handleSubscriptionsCommand({ ui, homeDir: home })).toBe(0)
    expect(output.join('\n')).toContain(`${project}  (Public)`)
  })

  it('unsubscribes by path and reports unknown directories', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    await handleSubscribeCommand(
      project,
      { linkOnly: true, yes: true },
      { ui, homeDir: home, cwd: project },
    )
    expect(await handleUnsubscribeCommand(project, { ui, homeDir: home, cwd: project })).toBe(0)
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
    expect(output.join('\n')).toContain('Already-published sessions stay live')

    expect(await handleUnsubscribeCommand(project, { ui, homeDir: home, cwd: project })).toBe(1)
  })

  it('rejects a missing directory', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(
        join(project, 'missing'),
        { linkOnly: true, yes: true },
        { ui, homeDir: home, cwd: project },
      ),
    ).toBe(1)
    expect(errors.length).toBeGreaterThan(0)
  })
})

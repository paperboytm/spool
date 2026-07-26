import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { HubProject, HubProjectsResponse, HubTeam } from '../hub/client.js'
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
    handle: 'paperboy',
    role: 'member',
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

function projectDeps(projectPath: string, projects: HubProject[] = [PERSONAL_PROJECT]) {
  const response: HubProjectsResponse = {
    actor: { id: 'user_00000001' },
    projects,
  }
  return {
    env: { SPOOL_HUB_URL: 'https://hub.test', SPOOL_HUB_TOKEN: 'token' },
    resolveLocalIdentity: () => ({
      kind: 'path' as const,
      key: projectPath,
      displayName: 'spool',
    }),
    listProjects: async () => response,
  }
}

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
        { linkOnly: true, yes: true, project: PERSONAL_PROJECT.id },
        {
          ui,
          homeDir: home,
          cwd: project,
          now: () => '2026-07-24T00:00:00.000Z',
          ...projectDeps(project),
        },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('Link-only')
    expect(loadSubscriptions({ homeDir: home })).toEqual([
      {
        path: project,
        visibility: 'link-only',
        project: {
          hubUrl: 'https://hub.test',
          actorId: 'user_00000001',
          tenant: { kind: 'user', id: 'user_00000001' },
          localIdentity: { kind: 'path', key: project, displayName: 'spool' },
          remote: PERSONAL_PROJECT,
        },
        addedAt: '2026-07-24T00:00:00.000Z',
      },
    ])
  })

  it('subscribes to a Team by name and stores id and name', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { team: 'Paperboy', yes: true, project: TEAM_PROJECT.id },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => TEAMS,
          now: () => '2026-07-24T00:00:00.000Z',
          ...projectDeps(project, [PERSONAL_PROJECT, TEAM_PROJECT]),
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
        project: {
          hubUrl: 'https://hub.test',
          actorId: 'user_00000001',
          tenant: { kind: 'team', id: 'team_00000001' },
          localIdentity: { kind: 'path', key: project, displayName: 'spool' },
          remote: TEAM_PROJECT,
        },
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

  it('accepts a Team handle and rejects an ambiguous display name', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()
    const duplicateTeams: HubTeam[] = [
      { ...TEAMS[0]!, id: 'team_a', name: 'Shared', handle: 'shared-a' },
      { ...TEAMS[0]!, id: 'team_b', name: 'Shared', handle: 'shared-b' },
    ]

    expect(
      await handleSubscribeCommand(
        project,
        { team: 'Shared', createProject: 'Project', yes: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => duplicateTeams,
          ...projectDeps(project, []),
        },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('More than one Team is named "Shared"')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])

    const teamBProject = {
      ...TEAM_PROJECT,
      id: 'project_team_b',
      owner: { ...TEAM_PROJECT.owner, id: 'team_b', handle: 'shared-b', name: 'Shared' },
    }
    expect(
      await handleSubscribeCommand(
        project,
        { team: '@shared-b', project: teamBProject.id, yes: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => duplicateTeams,
          ...projectDeps(project, [teamBProject]),
        },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]?.teamId).toBe('team_b')
  })

  it('subscribes Public only as an explicit opt-in and lists it', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { public: true, yes: true, project: PERSONAL_PROJECT.id },
        { ui, homeDir: home, cwd: project, ...projectDeps(project) },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]?.visibility).toBe('public')

    expect(handleSubscriptionsCommand({ ui, homeDir: home })).toBe(0)
    expect(output.join('\n')).toContain(`${project}  (Public · Project evan/spool)`)
  })

  it('combines Team ownership with Public disclosure', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        {
          team: '@paperboy',
          public: true,
          project: 'paperboy/paperboy',
          yes: true,
        },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => TEAMS,
          ...projectDeps(project, [PERSONAL_PROJECT, TEAM_PROJECT]),
        },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]).toMatchObject({
      visibility: 'public',
      teamId: 'team_00000001',
      teamName: 'Paperboy',
      project: {
        tenant: { kind: 'team', id: 'team_00000001' },
        remote: { id: TEAM_PROJECT.id },
      },
    })
    expect(output.join('\n')).toContain('Public')
    expect(output.join('\n')).toContain('owned by Team · Paperboy')
  })

  it('derives a Team owner from an explicit owner/slug Project reference', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { public: true, project: 'paperboy/paperboy', yes: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          ...projectDeps(project, [PERSONAL_PROJECT, TEAM_PROJECT]),
        },
      ),
    ).toBe(0)
    expect(loadSubscriptions({ homeDir: home })[0]).toMatchObject({
      visibility: 'public',
      teamId: 'team_00000001',
      project: { tenant: { kind: 'team', id: 'team_00000001' } },
    })
  })

  it('selects Project ownership before independently choosing visibility', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const messages: string[] = []
    const projectLabels: string[] = []
    const baseUi = createTextUi()
    const ui = {
      ...baseUi,
      interactive: true,
      select: async ({
        message,
        choices,
      }: {
        message: string
        choices: Array<{ value: string; label: string }>
      }) => {
        messages.push(message)
        if (message.startsWith('Which Hub Project')) {
          projectLabels.push(...choices.map((choice) => choice.label))
          return TEAM_PROJECT.id
        }
        return 'public'
      },
      confirm: async () => true,
    }

    expect(
      await handleSubscribeCommand(
        project,
        {},
        {
          ui,
          homeDir: home,
          cwd: project,
          ...projectDeps(project, [PERSONAL_PROJECT, TEAM_PROJECT]),
        },
      ),
    ).toBe(0)
    expect(projectLabels).toEqual(['evan/spool', 'paperboy/paperboy', 'Create Project “spool”'])
    expect(messages).toEqual([
      'Which Hub Project should "spool" publish to?',
      'How should auto-published Sessions be shared?',
    ])
    expect(loadSubscriptions({ homeDir: home })[0]).toMatchObject({
      visibility: 'public',
      teamId: 'team_00000001',
    })
  })

  it('defers an interactive Project creation until the subscription is confirmed', async () => {
    const home = tempDir('spool-subscribe-create-deferred-home-')
    const project = tempDir('spool-subscribe-create-deferred-project-')
    let createCalls = 0
    const baseUi = createTextUi()
    const ui = {
      ...baseUi,
      interactive: true,
      select: async ({ choices }: { choices: Array<{ value: string; label: string }> }) =>
        choices.find((choice) => choice.label.startsWith('Create Project'))?.value ?? null,
      confirm: async () => false,
    }

    expect(
      await handleSubscribeCommand(
        project,
        { public: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          ...projectDeps(project, []),
          fetch: async () => {
            createCalls += 1
            throw new Error('Project creation must remain deferred')
          },
        },
      ),
    ).toBe(1)
    expect(createCalls).toBe(0)
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('creates an interactively selected Project after confirmation and subscribes to it', async () => {
    const home = tempDir('spool-subscribe-create-confirmed-home-')
    const project = tempDir('spool-subscribe-create-confirmed-project-')
    let createCalls = 0
    const createdProject = {
      ...PERSONAL_PROJECT,
      id: 'project_created01',
      name: 'spool',
      slug: 'spool',
    }
    const baseUi = createTextUi()
    const ui = {
      ...baseUi,
      interactive: true,
      select: async ({ choices }: { choices: Array<{ value: string; label: string }> }) =>
        choices.find((choice) => choice.label.startsWith('Create Project'))?.value ?? null,
      confirm: async () => true,
    }

    expect(
      await handleSubscribeCommand(
        project,
        { public: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          ...projectDeps(project, []),
          fetch: async (input, init) => {
            expect(new URL(String(input)).pathname).toBe('/api/hub/v1/projects')
            expect(init?.method).toBe('POST')
            createCalls += 1
            return new Response(JSON.stringify({ project: createdProject }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          },
        },
      ),
    ).toBe(0)
    expect(createCalls).toBe(1)
    expect(loadSubscriptions({ homeDir: home })[0]).toMatchObject({
      visibility: 'public',
      project: {
        tenant: { kind: 'user', id: 'user_00000001' },
        remote: { id: createdProject.id },
      },
    })
  })

  it('rejects a Project whose owner conflicts with --team', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, errors } = capturingUi()

    expect(
      await handleSubscribeCommand(
        project,
        { team: 'paperboy', public: true, project: PERSONAL_PROJECT.id, yes: true },
        {
          ui,
          homeDir: home,
          cwd: project,
          listTeams: async () => TEAMS,
          ...projectDeps(project, [PERSONAL_PROJECT, TEAM_PROJECT]),
        },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('different owner')
    expect(loadSubscriptions({ homeDir: home })).toEqual([])
  })

  it('unsubscribes by path and reports unknown directories', async () => {
    const home = tempDir('spool-subscribe-home-')
    const project = tempDir('spool-subscribe-project-')
    const { ui, output } = capturingUi()

    await handleSubscribeCommand(
      project,
      { linkOnly: true, yes: true, project: PERSONAL_PROJECT.id },
      { ui, homeDir: home, cwd: project, ...projectDeps(project) },
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

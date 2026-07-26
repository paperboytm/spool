import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import type { HubProject } from '../hub/client.js'
import { loadProjectBindings } from '../hub/project-bindings.js'
import { createTextUi } from '../ui.js'
import {
  handleProjectsBindCommand,
  handleProjectsListCommand,
  handleProjectsMoveCommand,
  projectsCommand,
} from './projects.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const project: HubProject = {
  id: 'project_spool0001',
  slug: 'spool',
  name: 'Spool',
  description: null,
  github_url: null,
  owner: { kind: 'user', id: 'user_1', handle: 'evan', name: 'Evan' },
  can_manage: true,
}
const destination: HubProject = {
  ...project,
  id: 'project_vapor0001',
  slug: 'react-vapor',
  name: 'React Vapor',
}
const teamProject: HubProject = {
  ...project,
  id: 'project_team00001',
  slug: 'spool',
  owner: { kind: 'team', id: 'team_1', handle: 'paperboy', name: 'Paperboy' },
}

function sessionResponse(projectValue: HubProject = project) {
  return {
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
    visibility: 'public',
    project: projectValue,
    author: { handle: 'evan', displayName: 'Evan', avatarUrl: null },
  }
}

function setup() {
  const homeDir = mkdtempSync(join(tmpdir(), 'spool-project-command-home-'))
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'spool-project-command-cwd-')))
  dirs.push(homeDir, cwd)
  const output: string[] = []
  const errors: string[] = []
  const ui = createTextUi(
    (message) => output.push(message),
    (message) => errors.push(message),
  )
  const dependencies = {
    ui,
    homeDir,
    cwd,
    env: { SPOOL_HUB_URL: 'https://hub.test', SPOOL_HUB_TOKEN: 'token' },
    listProjects: async () => ({ actor: { id: 'user_1' }, projects: [project] }),
    resolveLocalIdentity: () => ({
      kind: 'git_remote' as const,
      key: 'github.com/paperboytm/spool',
      displayName: 'spool',
    }),
  }
  return { homeDir, cwd, output, errors, dependencies }
}

describe('projects command', () => {
  it('lists writable Projects and binds an exact owner/slug', async () => {
    const { homeDir, cwd, output, errors, dependencies } = setup()
    expect(await handleProjectsListCommand({}, dependencies)).toBe(0)
    expect(output.join('\n')).toContain('evan/spool')

    expect(await handleProjectsBindCommand(cwd, 'evan/spool', dependencies)).toBe(0)
    expect(errors).toEqual([])
    expect(loadProjectBindings({ homeDir })[0]).toMatchObject({
      actorId: 'user_1',
      project: { id: project.id },
      localIdentity: {
        kind: 'git_remote',
        key: 'github.com/paperboytm/spool',
      },
    })
  })

  it('filters Team Projects by a stable @handle', async () => {
    const { dependencies, output } = setup()
    expect(
      await handleProjectsListCommand(
        { team: '@paperboy' },
        {
          ...dependencies,
          listProjects: async () => ({
            actor: { id: 'user_1' },
            projects: [project, teamProject],
          }),
        },
      ),
    ).toBe(0)
    expect(output.join('\n')).toContain('paperboy/spool')
    expect(output.join('\n')).not.toContain('evan/spool')
  })

  it('moves a hosted Session only within its current tenant with an optimistic precondition', async () => {
    const { dependencies, output, errors } = setup()
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (init?.method === 'GET' && path === '/api/hub/v1/sessions/claude_abc12345') {
        return Response.json(sessionResponse())
      }
      if (init?.method === 'PATCH' && path === '/api/me/sessions/claude_abc12345') {
        return Response.json({
          session: {
            sid: 'claude_abc12345',
            visibility: 'public',
            team_id: null,
            team_name: null,
            project_id: destination.id,
            project: destination,
          },
        })
      }
      throw new Error(`Unexpected request: ${init?.method} ${path}`)
    })

    expect(
      await handleProjectsMoveCommand(
        'claude_abc12345',
        'evan/react-vapor',
        { yes: true },
        {
          ...dependencies,
          fetch: fetch as never,
          listProjects: async () => ({
            actor: { id: 'user_1' },
            projects: [project, destination, teamProject],
          }),
        },
      ),
    ).toBe(0)

    const [, patch] = fetch.mock.calls.find((call) => call[1]?.method === 'PATCH') as [
      unknown,
      RequestInit,
    ]
    expect(JSON.parse(String(patch.body))).toEqual({
      visibility: 'public',
      project_id: destination.id,
      expected_project_id: project.id,
    })
    expect(errors).toEqual([])
    expect(output.join('\n')).toContain('visibility, authorship, stars')
    expect(output.join('\n')).toContain('Moved Session claude_abc12345')
  })

  it('rejects a Project from another tenant before sending a mutation', async () => {
    const { dependencies, errors } = setup()
    const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const path = new URL(String(url)).pathname
      if (init?.method === 'GET' && path === '/api/hub/v1/sessions/claude_abc12345') {
        return Response.json(sessionResponse())
      }
      throw new Error(`Unexpected request: ${init?.method} ${path}`)
    })

    expect(
      await handleProjectsMoveCommand(
        'claude_abc12345',
        'paperboy/spool',
        { yes: true },
        {
          ...dependencies,
          fetch: fetch as never,
          listProjects: async () => ({
            actor: { id: 'user_1' },
            projects: [project, destination, teamProject],
          }),
        },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('different owner')
    expect(errors.join('\n')).toContain('cannot change the Session tenant')
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false)
  })

  it('requires an explicit confirmation in non-interactive use', async () => {
    const { dependencies, errors } = setup()
    const fetch = vi.fn(async () => Response.json(sessionResponse()))

    expect(
      await handleProjectsMoveCommand(
        'claude_abc12345',
        destination.id,
        {},
        {
          ...dependencies,
          fetch: fetch as never,
          listProjects: async () => ({
            actor: { id: 'user_1' },
            projects: [project, destination],
          }),
        },
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('Re-run with `--yes`')
    expect(fetch.mock.calls.some((call) => call[1]?.method === 'PATCH')).toBe(false)
  })

  it('exposes the move command and its Project option in help', () => {
    const move = projectsCommand.commands.find((command) => command.name() === 'move')
    expect(move).toBeDefined()
    expect(move?.helpInformation()).toContain('--project <id-or-owner-slug>')
    expect(move?.helpInformation()).toContain('--yes')
  })
})

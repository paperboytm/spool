import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vite-plus/test'

import { createTextUi } from '../ui.js'
import type { HubProject } from './client.js'
import { materializeHubProject, resolveHubProject } from './project-resolution.js'

const project: HubProject = {
  id: 'project_spool0001',
  slug: 'spool',
  name: 'Spool',
  description: null,
  github_url: null,
  owner: { kind: 'user', id: 'user_1', handle: 'evan', name: 'Evan' },
  can_manage: true,
}
const teamProject: HubProject = {
  ...project,
  id: 'project_team00001',
  slug: 'spool',
  owner: { kind: 'team', id: 'team_1', handle: 'paperboy', name: 'Paperboy' },
}

const localIdentity = {
  kind: 'git_remote' as const,
  key: 'github.com/paperboytm/spool',
  displayName: 'spool',
}

describe('resolveHubProject', () => {
  it('fails closed without a binding or explicit Project in a non-TTY', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'spool-project-resolution-'))
    const client = {
      listProjects: async () => ({ actor: { id: 'user_1' }, projects: [project] }),
      createProject: vi.fn(),
    }
    try {
      await expect(
        resolveHubProject({
          client,
          ui: createTextUi(),
          hubUrl: 'https://hub.test',
          localIdentity,
          tenant: { kind: 'personal' },
          homeDir,
        }),
      ).rejects.toThrow(/--yes` never chooses a Project/)
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })

  it('preserves the hosted Project when re-sharing', async () => {
    const other = { ...project, id: 'project_other0001', slug: 'other', name: 'Other' }
    const client = {
      listProjects: async () => ({
        actor: { id: 'user_1' },
        projects: [project, other],
      }),
      createProject: vi.fn(),
    }
    await expect(
      resolveHubProject({
        client,
        ui: createTextUi(),
        hubUrl: 'https://hub.test',
        localIdentity,
        tenant: { kind: 'personal' },
        projectRef: other.id,
        existingProject: project,
      }),
    ).rejects.toThrow(/Re-sharing preserves its remote Project/)
  })

  it('derives the tenant from an explicit owner/slug reference', async () => {
    const result = await resolveHubProject({
      client: {
        listProjects: async () => ({
          actor: { id: 'user_1' },
          projects: [project, teamProject],
        }),
        createProject: vi.fn(),
      },
      ui: createTextUi(),
      hubUrl: 'https://hub.test',
      localIdentity,
      projectRef: 'paperboy/spool',
    })

    expect(result).toMatchObject({
      tenant: { kind: 'team', id: 'team_1' },
      project: { id: teamProject.id },
    })
  })

  it('rejects an explicit Project that conflicts with the selected Team', async () => {
    await expect(
      resolveHubProject({
        client: {
          listProjects: async () => ({
            actor: { id: 'user_1' },
            projects: [project, teamProject],
          }),
          createProject: vi.fn(),
        },
        ui: createTextUi(),
        hubUrl: 'https://hub.test',
        localIdentity,
        tenant: { kind: 'team', id: 'team_1' },
        projectRef: 'evan/spool',
      }),
    ).rejects.toThrow(/different owner/)
  })

  it('lists personal and Team Projects together when no owner is constrained', async () => {
    let labels: string[] = []
    const baseUi = createTextUi()
    const result = await resolveHubProject({
      client: {
        listProjects: async () => ({
          actor: { id: 'user_1' },
          projects: [project, teamProject],
        }),
        createProject: vi.fn(),
      },
      ui: {
        ...baseUi,
        interactive: true,
        select: async ({ choices }) => {
          labels = choices.map((choice) => choice.label)
          return teamProject.id
        },
      },
      hubUrl: 'https://hub.test',
      localIdentity,
      includeCreateChoice: false,
    })

    expect(labels).toEqual(['evan/spool', 'paperboy/spool'])
    expect(result).toMatchObject({
      tenant: { kind: 'team', id: 'team_1' },
      project: { id: teamProject.id },
    })
  })

  it('defers an interactive Project creation until the enclosing flow confirms', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'spool-project-resolution-deferred-'))
    const createProject = vi.fn(async () => project)
    const baseUi = createTextUi()
    try {
      const selection = await resolveHubProject({
        client: {
          listProjects: async () => ({ actor: { id: 'user_1' }, projects: [] }),
          createProject,
        },
        ui: {
          ...baseUi,
          interactive: true,
          select: async ({ choices }) =>
            choices.find((choice) => choice.label.startsWith('Create Project'))?.value ?? null,
        },
        hubUrl: 'https://hub.test',
        localIdentity,
        deferCreate: true,
        homeDir,
      })

      expect(selection).toMatchObject({
        kind: 'create',
        actorId: 'user_1',
        tenant: { kind: 'user', id: 'user_1' },
        name: 'spool',
      })
      expect(createProject).not.toHaveBeenCalled()

      const resolved = await materializeHubProject(selection!, { createProject })
      expect(createProject).toHaveBeenCalledTimes(1)
      expect(resolved).toMatchObject({
        kind: 'resolved',
        project: { id: project.id },
      })
    } finally {
      rmSync(homeDir, { recursive: true, force: true })
    }
  })
})

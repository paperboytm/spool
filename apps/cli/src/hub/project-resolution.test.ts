import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vite-plus/test'

import { createTextUi } from '../ui.js'
import type { HubProject } from './client.js'
import { resolveHubProject } from './project-resolution.js'

const project: HubProject = {
  id: 'project_spool0001',
  slug: 'spool',
  name: 'Spool',
  description: null,
  github_url: null,
  owner: { kind: 'user', id: 'user_1', handle: 'evan', name: 'Evan' },
  can_manage: true,
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
})

import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { HubProject } from './client.js'
import {
  findProjectBinding,
  loadProjectBindings,
  projectBindingsPath,
  upsertProjectBinding,
} from './project-bindings.js'

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

describe('Project bindings', () => {
  it('stores a 0600 binding scoped by Hub, actor, tenant, and local identity', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'spool-project-bindings-'))
    dirs.push(homeDir)
    const localIdentity = {
      kind: 'git_remote' as const,
      key: 'github.com/paperboytm/spool',
      displayName: 'spool',
    }
    upsertProjectBinding(
      {
        hubUrl: 'https://hub.example/',
        actorId: 'user_1',
        tenant: { kind: 'user', id: 'user_1' },
        localIdentity,
        project,
      },
      { homeDir },
    )

    const path = projectBindingsPath({ homeDir })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const bindings = loadProjectBindings({ homeDir })
    expect(
      findProjectBinding(bindings, {
        hubUrl: 'https://hub.example',
        actorId: 'user_1',
        tenant: { kind: 'user', id: 'user_1' },
        localIdentity,
      })?.project.id,
    ).toBe(project.id)
    expect(
      findProjectBinding(bindings, {
        hubUrl: 'https://hub.example',
        actorId: 'another-user',
        tenant: { kind: 'user', id: 'another-user' },
        localIdentity,
      }),
    ).toBeUndefined()
  })
})

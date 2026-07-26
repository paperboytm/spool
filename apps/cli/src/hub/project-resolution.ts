import { createHash } from 'node:crypto'

import type { ProjectIdentity } from '@spool-lab/core'

import type { CliUi } from '../ui.js'
import { type HubClient, type HubProject, type HubProjectsResponse } from './client.js'
import type { HubCredentialOptions } from './credentials.js'
import {
  findProjectBinding,
  loadProjectBindings,
  type ProjectBindingTenant,
  upsertProjectBinding,
} from './project-bindings.js'

const CREATE_PROJECT = '__create_project__'

export interface ResolvedHubProject {
  actorId: string
  tenant: ProjectBindingTenant
  localIdentity: ProjectIdentity
  project: HubProject
  /** New/explicit selections are persisted only after the enclosing mutation succeeds. */
  shouldPersistBinding: boolean
  hubUrl: string
}

export interface ResolveHubProjectOptions extends HubCredentialOptions {
  client: Pick<HubClient, 'listProjects' | 'createProject'>
  ui: CliUi
  hubUrl: string
  localIdentity: ProjectIdentity
  tenant: { kind: 'personal' } | { kind: 'team'; id: string }
  projectRef?: string
  createProjectName?: string
  /** A hosted Session's current Project is authoritative on re-share. */
  existingProject?: HubProject | null
  listResponse?: HubProjectsResponse
}

export async function resolveHubProject(
  options: ResolveHubProjectOptions,
): Promise<ResolvedHubProject | null> {
  if (options.projectRef !== undefined && options.createProjectName !== undefined) {
    throw new Error('`--project` and `--create-project` cannot be used together.')
  }

  const response = options.listResponse ?? (await options.client.listProjects())
  const tenant: ProjectBindingTenant =
    options.tenant.kind === 'team'
      ? { kind: 'team', id: options.tenant.id }
      : { kind: 'user', id: response.actor.id }
  const eligible = response.projects.filter(
    (project) => project.owner.kind === tenant.kind && project.owner.id === tenant.id,
  )

  if (options.existingProject) {
    const explicit =
      options.projectRef === undefined
        ? undefined
        : findProjectByReference(response.projects, options.projectRef)
    if (options.projectRef !== undefined && explicit === undefined) {
      throw unknownProjectError(options.projectRef, eligible)
    }
    if (
      options.createProjectName !== undefined ||
      (explicit && explicit.id !== options.existingProject.id)
    ) {
      throw new Error(
        `Session is already in Project ${projectLabel(options.existingProject)}. ` +
          'Re-sharing preserves its remote Project; move it first with `spool projects move <sid|url> --project <id|owner/slug>`.',
      )
    }
    return {
      actorId: response.actor.id,
      tenant,
      localIdentity: options.localIdentity,
      project: options.existingProject,
      shouldPersistBinding: false,
      hubUrl: options.hubUrl,
    }
  }

  if (options.projectRef !== undefined) {
    const project = findProjectByReference(eligible, options.projectRef)
    if (!project) throw unknownProjectError(options.projectRef, eligible)
    return resolved(options, response.actor.id, tenant, project, true)
  }

  if (options.createProjectName !== undefined) {
    const project = await createProject(
      options,
      response.actor.id,
      tenant,
      options.createProjectName,
    )
    return resolved(options, response.actor.id, tenant, project, true)
  }

  const binding = findProjectBinding(loadProjectBindings(options), {
    hubUrl: options.hubUrl,
    actorId: response.actor.id,
    tenant,
    localIdentity: options.localIdentity,
  })
  if (binding) {
    const live = eligible.find((project) => project.id === binding.project.id)
    if (live) return resolved(options, response.actor.id, tenant, live, false)
    options.ui.warn(
      `The saved Project binding for ${options.localIdentity.displayName} no longer exists or is not writable.`,
    )
  }

  if (!options.ui.interactive) {
    throw new Error(
      `No Hub Project is bound to local Project "${options.localIdentity.displayName}". ` +
        'Pass `--project <id|owner/slug>` or `--create-project <name>`; `--yes` never chooses a Project.',
    )
  }

  const selected = await options.ui.select({
    message: `Which Hub Project should "${options.localIdentity.displayName}" publish to?`,
    choices: [
      ...eligible.map((project) => ({
        value: project.id,
        label: project.name,
        hint: projectLabel(project),
      })),
      {
        value: CREATE_PROJECT,
        label: `Create Project “${options.localIdentity.displayName}”`,
        hint: tenant.kind === 'team' ? 'owned by this Team' : 'owned by you',
      },
    ],
    initialValue: eligible[0]?.id ?? CREATE_PROJECT,
  })
  if (selected === null) {
    options.ui.cancel('No Project selected.')
    return null
  }
  const project =
    selected === CREATE_PROJECT
      ? await createProject(options, response.actor.id, tenant, options.localIdentity.displayName)
      : eligible.find((entry) => entry.id === selected)
  if (!project) throw new Error('The selected Hub Project is no longer available.')
  return resolved(options, response.actor.id, tenant, project, true)
}

export function persistResolvedProject(
  resolvedProject: ResolvedHubProject,
  options: HubCredentialOptions = {},
): void {
  if (!resolvedProject.shouldPersistBinding) return
  upsertProjectBinding(
    {
      hubUrl: resolvedProject.hubUrl,
      actorId: resolvedProject.actorId,
      tenant: resolvedProject.tenant,
      localIdentity: {
        kind: resolvedProject.localIdentity.kind,
        key: resolvedProject.localIdentity.key,
        displayName: resolvedProject.localIdentity.displayName,
      },
      project: resolvedProject.project,
    },
    options,
  )
}

export function findProjectByReference(
  projects: readonly HubProject[],
  reference: string,
): HubProject | undefined {
  const wanted = reference.trim()
  return projects.find((project) => {
    const owner = project.owner.handle ?? project.owner.id
    return project.id === wanted || `${owner}/${project.slug}` === wanted
  })
}

export function projectLabel(project: HubProject): string {
  return `${project.owner.handle ?? project.owner.id}/${project.slug}`
}

function resolved(
  options: ResolveHubProjectOptions,
  actorId: string,
  tenant: ProjectBindingTenant,
  project: HubProject,
  shouldPersistBinding: boolean,
): ResolvedHubProject {
  return {
    actorId,
    tenant,
    localIdentity: options.localIdentity,
    project,
    shouldPersistBinding,
    hubUrl: options.hubUrl,
  }
}

async function createProject(
  options: ResolveHubProjectOptions,
  actorId: string,
  tenant: ProjectBindingTenant,
  name: string,
): Promise<HubProject> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('`--create-project` requires a non-empty Project name.')
  const key = createIdempotencyKey(options.hubUrl, actorId, tenant, options.localIdentity, trimmed)
  return options.client.createProject({ name: trimmed, owner: tenant }, key)
}

function createIdempotencyKey(
  hubUrl: string,
  actorId: string,
  tenant: ProjectBindingTenant,
  identity: ProjectIdentity,
  name: string,
): string {
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        hubUrl,
        actorId,
        tenant,
        identity: { kind: identity.kind, key: identity.key },
        name,
      }),
    )
    .digest('hex')
  return `spool-project-${digest}`
}

function unknownProjectError(reference: string, projects: readonly HubProject[]): Error {
  const choices = projects.map(projectLabel)
  return new Error(
    choices.length === 0
      ? `No writable Hub Project matches "${reference}" in the selected tenant.`
      : `No Hub Project matches "${reference}". Available Projects: ${choices.join(', ')}`,
  )
}

import { createHash } from 'node:crypto'

import type { ProjectIdentity } from '@spool-lab/core'

import type { CliUi } from '../ui.js'
import { type HubClient, type HubProject, type HubProjectsResponse } from './client.js'
import { normalizeHubUrl, type HubCredentialOptions } from './credentials.js'
import {
  findProjectBinding,
  loadProjectBindings,
  type ProjectBindingTenant,
  upsertProjectBinding,
} from './project-bindings.js'

const CREATE_PROJECT = '__create_project__'

export interface ResolvedHubProject {
  kind: 'resolved'
  actorId: string
  tenant: ProjectBindingTenant
  localIdentity: ProjectIdentity
  project: HubProject
  /** New/explicit selections are persisted only after the enclosing mutation succeeds. */
  shouldPersistBinding: boolean
  hubUrl: string
}

export interface PendingHubProjectCreation {
  kind: 'create'
  actorId: string
  tenant: ProjectBindingTenant
  localIdentity: ProjectIdentity
  name: string
  hubUrl: string
}

export type HubProjectSelection = ResolvedHubProject | PendingHubProjectCreation

export interface ResolveHubProjectOptions extends HubCredentialOptions {
  client: Pick<HubClient, 'listProjects' | 'createProject'>
  ui: CliUi
  hubUrl: string
  localIdentity: ProjectIdentity
  /**
   * Optional owner constraint. When omitted, an exact owner/slug reference,
   * saved binding, or interactive Project selection determines the tenant.
   */
  tenant?: { kind: 'personal' } | { kind: 'team'; id: string }
  projectRef?: string
  createProjectName?: string
  /** A hosted Session's current Project is authoritative on re-share. */
  existingProject?: HubProject | null
  listResponse?: HubProjectsResponse
  /** Omit the mutating "Create" choice when disclosure has not been confirmed yet. */
  includeCreateChoice?: boolean
  /** Return a creation plan so the caller can confirm disclosure before writing. */
  deferCreate?: boolean
}

export function resolveHubProject(
  options: ResolveHubProjectOptions & { deferCreate: true },
): Promise<HubProjectSelection | null>
export function resolveHubProject(
  options: ResolveHubProjectOptions & { deferCreate?: false },
): Promise<ResolvedHubProject | null>
export async function resolveHubProject(
  options: ResolveHubProjectOptions,
): Promise<HubProjectSelection | null> {
  if (options.projectRef !== undefined && options.createProjectName !== undefined) {
    throw new Error('`--project` and `--create-project` cannot be used together.')
  }

  const response = options.listResponse ?? (await options.client.listProjects())
  const tenantConstraint: ProjectBindingTenant | undefined =
    options.tenant?.kind === 'team'
      ? { kind: 'team', id: options.tenant.id }
      : options.tenant?.kind === 'personal'
        ? { kind: 'user', id: response.actor.id }
        : undefined
  const eligible =
    tenantConstraint === undefined
      ? response.projects
      : response.projects.filter((project) => projectMatchesTenant(project, tenantConstraint))

  if (options.existingProject) {
    const existingTenant = projectTenant(options.existingProject)
    if (tenantConstraint && !sameTenant(existingTenant, tenantConstraint)) {
      throw new Error(
        `Session is already in Project ${projectLabel(options.existingProject)}, which belongs to a different owner.`,
      )
    }
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
      kind: 'resolved',
      actorId: response.actor.id,
      tenant: existingTenant,
      localIdentity: options.localIdentity,
      project: options.existingProject,
      shouldPersistBinding: false,
      hubUrl: options.hubUrl,
    }
  }

  if (options.projectRef !== undefined) {
    const project = findProjectByReference(response.projects, options.projectRef)
    if (!project) throw unknownProjectError(options.projectRef, eligible)
    const tenant = projectTenant(project)
    if (tenantConstraint && !sameTenant(tenant, tenantConstraint)) {
      throw new Error(
        `Project ${projectLabel(project)} belongs to a different owner than the selected tenant.`,
      )
    }
    return resolved(options, response.actor.id, tenant, project, true)
  }

  if (options.createProjectName !== undefined) {
    const tenant = tenantConstraint ?? { kind: 'user', id: response.actor.id }
    if (options.deferCreate) {
      return pending(options, response.actor.id, tenant, options.createProjectName)
    }
    const project = await createProject(
      options,
      response.actor.id,
      tenant,
      options.createProjectName,
    )
    return resolved(options, response.actor.id, tenant, project, true)
  }

  const bindings = loadProjectBindings(options)
  const relevantBindings = bindings.filter(
    (binding) =>
      binding.hubUrl === normalizeHubUrl(options.hubUrl) &&
      binding.actorId === response.actor.id &&
      binding.localIdentity.kind === options.localIdentity.kind &&
      binding.localIdentity.key === options.localIdentity.key &&
      (tenantConstraint === undefined || sameTenant(binding.tenant, tenantConstraint)),
  )
  const boundProjects = eligible.filter((project) => {
    const tenant = projectTenant(project)
    const binding = findProjectBinding(bindings, {
      hubUrl: options.hubUrl,
      actorId: response.actor.id,
      tenant,
      localIdentity: options.localIdentity,
    })
    return binding?.project.id === project.id
  })
  if (boundProjects.length === 1 && boundProjects[0]) {
    const project = boundProjects[0]
    return resolved(options, response.actor.id, projectTenant(project), project, false)
  }
  if (relevantBindings.length > 0 && boundProjects.length === 0) {
    options.ui.warn(
      `The saved Project binding for ${options.localIdentity.displayName} no longer exists or is not writable.`,
    )
  }

  if (!options.ui.interactive) {
    throw new Error(
      (boundProjects.length > 1
        ? `More than one Hub Project is bound to local Project "${options.localIdentity.displayName}". `
        : `No Hub Project is bound to local Project "${options.localIdentity.displayName}". `) +
        'Pass `--project <id|owner/slug>` or `--create-project <name>`; `--yes` never chooses a Project.',
    )
  }

  const createTenant = tenantConstraint ?? { kind: 'user', id: response.actor.id }
  if (eligible.length === 0 && options.includeCreateChoice === false) {
    throw new Error(
      `No Hub Projects are available for local Project "${options.localIdentity.displayName}". ` +
        'Pass `--create-project <name>` after choosing the intended owner and visibility.',
    )
  }
  const selected = await options.ui.select({
    message: `Which Hub Project should "${options.localIdentity.displayName}" publish to?`,
    choices: [
      ...eligible.map((project) => ({
        value: project.id,
        label: projectLabel(project),
        hint: project.name,
      })),
      ...(options.includeCreateChoice === false
        ? []
        : [
            {
              value: CREATE_PROJECT,
              label: `Create Project “${options.localIdentity.displayName}”`,
              hint:
                createTenant.kind === 'team'
                  ? 'owned by the selected Team'
                  : tenantConstraint === undefined
                    ? 'owned by you; use --team to create for a Team'
                    : 'owned by you',
            },
          ]),
    ],
    initialValue: boundProjects[0]?.id ?? eligible[0]?.id ?? CREATE_PROJECT,
  })
  if (selected === null) {
    options.ui.cancel('No Project selected.')
    return null
  }
  if (selected === CREATE_PROJECT && options.deferCreate) {
    return pending(options, response.actor.id, createTenant, options.localIdentity.displayName)
  }
  const project =
    selected === CREATE_PROJECT
      ? await createProject(
          options,
          response.actor.id,
          createTenant,
          options.localIdentity.displayName,
        )
      : eligible.find((entry) => entry.id === selected)
  if (!project) throw new Error('The selected Hub Project is no longer available.')
  return resolved(options, response.actor.id, projectTenant(project), project, true)
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

export async function materializeHubProject(
  selection: HubProjectSelection,
  client: Pick<HubClient, 'createProject'>,
): Promise<ResolvedHubProject> {
  if (selection.kind === 'resolved') return selection
  const project = await createProject(
    { hubUrl: selection.hubUrl, localIdentity: selection.localIdentity, client },
    selection.actorId,
    selection.tenant,
    selection.name,
  )
  return {
    kind: 'resolved',
    actorId: selection.actorId,
    tenant: selection.tenant,
    localIdentity: selection.localIdentity,
    project,
    shouldPersistBinding: true,
    hubUrl: selection.hubUrl,
  }
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

function projectTenant(project: HubProject): ProjectBindingTenant {
  return { kind: project.owner.kind, id: project.owner.id }
}

function projectMatchesTenant(project: HubProject, tenant: ProjectBindingTenant): boolean {
  return project.owner.kind === tenant.kind && project.owner.id === tenant.id
}

function sameTenant(left: ProjectBindingTenant, right: ProjectBindingTenant): boolean {
  return left.kind === right.kind && left.id === right.id
}

function resolved(
  options: ResolveHubProjectOptions,
  actorId: string,
  tenant: ProjectBindingTenant,
  project: HubProject,
  shouldPersistBinding: boolean,
): ResolvedHubProject {
  return {
    kind: 'resolved',
    actorId,
    tenant,
    localIdentity: options.localIdentity,
    project,
    shouldPersistBinding,
    hubUrl: options.hubUrl,
  }
}

function pending(
  options: ResolveHubProjectOptions,
  actorId: string,
  tenant: ProjectBindingTenant,
  name: string,
): PendingHubProjectCreation {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('`--create-project` requires a non-empty Project name.')
  return {
    kind: 'create',
    actorId,
    tenant,
    localIdentity: options.localIdentity,
    name: trimmed,
    hubUrl: options.hubUrl,
  }
}

async function createProject(
  options: {
    client: Pick<HubClient, 'createProject'>
    hubUrl: string
    localIdentity: ProjectIdentity
  },
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

import {
  formatCliCommand,
  formatCliInstallHint,
  getDB,
  resolveLocalProjectIdentity,
  type ProjectIdentity,
} from '@spool-lab/core'
import { Command } from 'commander'

import {
  HubClient,
  HubHttpError,
  type HubFetch,
  type HubProject,
  type HubProjectsResponse,
} from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { upsertProjectBinding } from '../hub/project-bindings.js'
import { findProjectByReference, projectLabel } from '../hub/project-resolution.js'
import { resolveSessionRef } from '../hub/ref.js'
import { canonicalSubscriptionPath } from '../subscriptions.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

export interface ProjectsCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  ui?: CliUi
  cwd?: string
  listProjects?: () => Promise<HubProjectsResponse>
  resolveLocalIdentity?: (path: string) => ProjectIdentity
}

export interface ProjectsMoveOptions {
  yes?: boolean
}

export async function handleProjectsListCommand(
  options: { team?: string; json?: boolean },
  dependencies: ProjectsCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  try {
    const response = await loadProjects(dependencies)
    let projects = response.projects
    if (options.team !== undefined) {
      const wanted = options.team.trim()
      const handle = wanted.startsWith('@') ? wanted.slice(1) : wanted
      projects = projects.filter(
        (project) =>
          project.owner.kind === 'team' &&
          (project.owner.id === wanted ||
            project.owner.name === wanted ||
            project.owner.handle?.toLowerCase() === handle.toLowerCase()),
      )
    }
    if (options.json === true) {
      ui.info(JSON.stringify({ actor: response.actor, projects }, null, 2))
      return 0
    }
    if (projects.length === 0) {
      ui.info(
        options.team === undefined
          ? 'No writable Hub Projects.'
          : `No writable Projects for Team "${options.team}".`,
      )
      return 0
    }
    for (const project of projects) {
      ui.info(`${project.id}  ${projectLabel(project)}  ${project.name}  (${ownerLabel(project)})`)
    }
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export async function handleProjectsBindCommand(
  directory: string | undefined,
  projectRef: string,
  dependencies: ProjectsCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  try {
    const credentialOptions = pickCredentialOptions(dependencies)
    const credentials = loadHubCredentials(credentialOptions)
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      return 1
    }
    const cwd = dependencies.cwd ?? process.cwd()
    const path = canonicalSubscriptionPath(directory ?? cwd, cwd)
    const localIdentity =
      dependencies.resolveLocalIdentity?.(path) ?? resolveLocalProjectIdentity(getDB(true), path)
    const response = await loadProjects(dependencies)
    const project = findProjectByReference(response.projects, projectRef)
    if (!project) {
      ui.error(
        response.projects.length === 0
          ? 'No writable Hub Projects are available.'
          : `No Project matches "${projectRef}". Available Projects: ${response.projects.map(projectLabel).join(', ')}`,
      )
      return 1
    }
    upsertProjectBinding(
      {
        hubUrl: credentials.hubUrl,
        actorId: response.actor.id,
        tenant: { kind: project.owner.kind, id: project.owner.id },
        localIdentity: {
          kind: localIdentity.kind,
          key: localIdentity.key,
          displayName: localIdentity.displayName,
        },
        project,
      },
      credentialOptions,
    )
    ui.success(`Bound local Project "${localIdentity.displayName}" to ${projectLabel(project)}.`)
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export async function handleProjectsMoveCommand(
  input: string,
  projectRef: string,
  options: ProjectsMoveOptions,
  dependencies: ProjectsCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  ui.intro('Move Session to Project')
  try {
    const credentialOptions = pickCredentialOptions(dependencies)
    const credentials = loadHubCredentials(credentialOptions)
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      ui.info(formatCliInstallHint())
      return 1
    }

    const ref = resolveSessionRef(input)
    const client = new HubClient({
      hubUrl: ref.hubUrl ?? credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })
    const current = await client.getSession(ref.sid)
    if (!current.project) {
      ui.error(
        'This Hub did not report the Session’s current Project. Update the Hub before moving it.',
      )
      return 1
    }
    if (!current.visibility) {
      ui.error(
        'This Hub did not report the Session’s visibility. The CLI will not guess during a Project move.',
      )
      return 1
    }

    const response = dependencies.listProjects
      ? await dependencies.listProjects()
      : await client.listProjects()
    const tenant = current.project.owner
    const eligible = response.projects.filter(
      (project) => project.owner.kind === tenant.kind && project.owner.id === tenant.id,
    )
    const project = findProjectByReference(eligible, projectRef)
    if (!project) {
      const otherTenant = findProjectByReference(response.projects, projectRef)
      if (otherTenant) {
        ui.error(
          `Project ${projectLabel(otherTenant)} belongs to a different owner. ` +
            'A Project move cannot change the Session tenant; use `spool visibility … team` for a Personal → Team transfer.',
        )
      } else {
        ui.error(
          eligible.length === 0
            ? `No writable Projects are available for ${ownerLabel(current.project)}.`
            : `No same-owner Project matches "${projectRef}". Available Projects: ${eligible.map(projectLabel).join(', ')}`,
        )
      }
      return 1
    }
    if (project.id === current.project.id) {
      ui.info(`Session ${ref.sid} already belongs to ${projectLabel(project)}.`)
      return 0
    }

    const confirmation =
      `Move Session ${ref.sid} from ${projectLabel(current.project)} to ${projectLabel(project)}? ` +
      'Records, visibility, authorship, stars, and verified-fork lineage stay unchanged.'
    if (options.yes !== true) {
      if (!ui.interactive) {
        ui.error('Cannot confirm a Project move without a TTY. Re-run with `--yes`.')
        return 1
      }
      const approved = await ui.confirm(confirmation, true)
      if (approved !== true) {
        ui.cancel('Project unchanged.')
        return 1
      }
    } else {
      ui.info(confirmation)
    }

    await client.updateSessionVisibility(ref.sid, current.visibility, {
      projectId: project.id,
      expectedProjectId: current.project.id,
    })
    ui.success(`Moved Session ${ref.sid} to ${projectLabel(project)}.`)
    ui.outro('Project updated; Session records and disclosure are unchanged.')
    return 0
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      if (cause.status === 409) {
        ui.error('The Session Project changed before this move completed. Review it and try again.')
      } else if (cause.status === 401) {
        ui.error(`Authentication failed. Run \`${formatCliCommand('login')}\` again.`)
        ui.info(formatCliInstallHint())
      } else if (cause.status === 403) {
        ui.error('You do not have permission to move this Session.')
      } else if (cause.status === 404) {
        ui.error(`Session or Project not found: ${input}`)
      } else {
        ui.error(`Hub returned HTTP ${cause.status}: ${cause.bodyMessage}`)
      }
    } else {
      ui.error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

async function loadProjects(
  dependencies: ProjectsCommandDependencies,
): Promise<HubProjectsResponse> {
  if (dependencies.listProjects) return dependencies.listProjects()
  const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
  if (!credentials.token) {
    throw new Error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
  }
  return new HubClient({
    hubUrl: credentials.hubUrl,
    token: credentials.token,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  }).listProjects()
}

function ownerLabel(project: HubProject): string {
  return project.owner.kind === 'team'
    ? `Team · ${project.owner.name ?? project.owner.handle ?? project.owner.id}`
    : 'Personal'
}

export const projectsCommand = new Command('projects').description(
  'List Hub Projects, bind local Projects, and move hosted Sessions',
)

projectsCommand
  .command('list')
  .description('List writable Hub Projects')
  .option('--team <handle-name-or-id>', 'Only Projects owned by this Team')
  .option('--json', 'Print machine-readable JSON')
  .action(async (options: { team?: string; json?: boolean }) => {
    const exitCode = await handleProjectsListCommand(options, { ui: createClackUi() })
    if (exitCode !== 0) process.exitCode = exitCode
  })

projectsCommand
  .command('bind')
  .description('Bind a local Project to a Hub Project')
  .argument('[dir]', 'Directory whose local Project identity should be bound')
  .requiredOption('--project <id-or-owner-slug>', 'Hub Project id or owner/slug')
  .action(async (directory: string | undefined, options: { project: string }) => {
    const exitCode = await handleProjectsBindCommand(directory, options.project, {
      ui: createClackUi(),
    })
    if (exitCode !== 0) process.exitCode = exitCode
  })

projectsCommand
  .command('move')
  .description('Move a hosted Session to another Project owned by the same user or Team')
  .argument('<sid|url>', 'Shared Session ID or URL')
  .requiredOption('--project <id-or-owner-slug>', 'Same-owner target Hub Project')
  .option('--yes', 'Skip the Project move confirmation')
  .action(
    async (
      input: string,
      options: {
        project: string
        yes?: boolean
      },
    ) => {
      const exitCode = await handleProjectsMoveCommand(
        input,
        options.project,
        { ...(options.yes === undefined ? {} : { yes: options.yes }) },
        { ui: createClackUi() },
      )
      if (exitCode !== 0) process.exitCode = exitCode
    },
  )

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

import {
  formatCliCommand,
  getDB,
  resolveLocalProjectIdentity,
  type ProjectIdentity,
} from '@spool-lab/core'
import { Command } from 'commander'

import {
  HubClient,
  type HubFetch,
  type HubProject,
  type HubProjectsResponse,
  type HubTeam,
} from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import {
  materializeHubProject,
  persistResolvedProject,
  resolveHubProject,
} from '../hub/project-resolution.js'
import { resolveTeamReference } from '../hub/team-resolution.js'
import {
  addSubscription,
  canonicalSubscriptionPath,
  loadSubscriptions,
  removeSubscription,
  type Subscription,
  type SubscriptionVisibility,
} from '../subscriptions.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// `spool subscribe [dir]` records the one-time decision that Sessions from a
// directory — and from its git worktrees — publish automatically. The
// Project ownership and disclosure are confirmed separately. Team-owned
// Projects default to Team-only, and Public is never preselected.

export interface SubscribeCommandOptions {
  team?: string
  linkOnly?: boolean
  public?: boolean
  yes?: boolean
  project?: string
  createProject?: string
}

export interface SubscribeCommandDependencies extends HubCredentialOptions {
  ui?: CliUi
  cwd?: string
  fetch?: HubFetch
  listTeams?: () => Promise<HubTeam[]>
  now?: () => string
  resolveLocalIdentity?: (path: string) => ProjectIdentity
  listProjects?: () => Promise<HubProjectsResponse>
}

interface VisibilityTarget {
  visibility: SubscriptionVisibility
}

export async function handleSubscribeCommand(
  directory: string | undefined,
  options: SubscribeCommandOptions,
  dependencies: SubscribeCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  const cwd = dependencies.cwd ?? process.cwd()
  ui.intro('Subscribe a directory')
  try {
    if (options.linkOnly === true && options.public === true) {
      ui.error('Pick exactly one of `--link-only` or `--public`.')
      return 1
    }
    if (options.project !== undefined && options.createProject !== undefined) {
      ui.error('`--project` and `--create-project` cannot be used together.')
      return 1
    }
    if (
      !ui.interactive &&
      options.team === undefined &&
      options.linkOnly !== true &&
      options.public !== true &&
      options.project === undefined &&
      options.createProject === undefined
    ) {
      ui.error('Choose a disclosure: `--team <name-or-id>`, `--link-only`, or `--public`.')
      return 1
    }

    const path = canonicalSubscriptionPath(directory ?? cwd, cwd)
    const credentialOptions = pickCredentialOptions(dependencies)
    const requestedTeam = await resolveRequestedTeam(ui, options.team, dependencies)
    if (options.team !== undefined && requestedTeam === null) return 1

    const credentials = loadHubCredentials(credentialOptions)
    if (!credentials.token) {
      if (options.linkOnly === true) {
        ui.info('Sessions from this directory and its worktrees would auto-publish as Link-only.')
      } else if (options.public === true) {
        ui.info('Sessions from this directory and its worktrees would auto-publish as Public.')
      }
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      return 1
    }
    const client = new HubClient({
      hubUrl: credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })
    const localIdentity =
      dependencies.resolveLocalIdentity?.(path) ?? resolveLocalProjectIdentity(getDB(true), path)
    const listResponse =
      dependencies.listProjects === undefined
        ? await client.listProjects()
        : await dependencies.listProjects()
    const projectSelection = await resolveHubProject({
      client,
      ui,
      hubUrl: credentials.hubUrl,
      localIdentity,
      ...(requestedTeam === null || requestedTeam === undefined
        ? {}
        : { tenant: { kind: 'team' as const, id: requestedTeam.id } }),
      ...(options.project === undefined ? {} : { projectRef: options.project }),
      ...(options.createProject === undefined ? {} : { createProjectName: options.createProject }),
      listResponse,
      deferCreate: true,
      ...credentialOptions,
    })
    if (!projectSelection) return 1
    const selectedProject =
      projectSelection.kind === 'resolved' ? projectSelection.project : undefined

    const ownerTeam =
      requestedTeam ?? (selectedProject ? teamOwnerFromProject(selectedProject) : undefined)
    const target = await resolveVisibilityTarget(ui, options, ownerTeam)
    if (target === null) return 1
    const projectDescription =
      projectSelection.kind === 'create'
        ? `new Project ${projectSelection.name}`
        : `Project ${projectReference(projectSelection.project)}`
    ui.info(disclosureCopy(target, ownerTeam, projectDescription))

    if (options.yes !== true) {
      if (!ui.interactive) {
        ui.error('Cannot confirm auto-publish visibility without a TTY. Re-run with `--yes`.')
        return 1
      }
      const approved = await ui.confirm(`Subscribe ${path}?`, true)
      if (approved !== true) {
        ui.cancel('Nothing subscribed.')
        return 1
      }
    }

    const resolvedProject = await materializeHubProject(projectSelection, client)

    const resolvedOwnerTeam = teamOwnerFromProject(resolvedProject.project)
    const subscription: Subscription = {
      path,
      visibility: target.visibility,
      ...(resolvedOwnerTeam === undefined ? {} : { teamId: resolvedOwnerTeam.id }),
      ...(resolvedOwnerTeam?.name === undefined ? {} : { teamName: resolvedOwnerTeam.name }),
      project: {
        hubUrl: resolvedProject.hubUrl,
        actorId: resolvedProject.actorId,
        tenant: resolvedProject.tenant,
        localIdentity: {
          kind: localIdentity.kind,
          key: localIdentity.key,
          displayName: localIdentity.displayName,
        },
        remote: resolvedProject.project,
      },
      addedAt: (dependencies.now ?? (() => new Date().toISOString()))(),
    }
    const { added } = addSubscription(subscription, credentialOptions)
    persistResolvedProject(resolvedProject, credentialOptions)
    ui.success(added ? `Subscribed ${path}` : `Already subscribed: ${path} (settings updated)`)
    ui.outro(
      `Run \`${formatCliCommand('daemon start')}\` to keep subscribed sessions continuously published.`,
    )
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

/** Resolve the disclosure target from flags, or interactively. Returns null
 *  after reporting the reason the choice could not be made. */
async function resolveVisibilityTarget(
  ui: CliUi,
  options: SubscribeCommandOptions,
  ownerTeam: TeamOwner | undefined,
): Promise<VisibilityTarget | null> {
  if (options.linkOnly === true) return { visibility: 'link-only' }
  if (options.public === true) return { visibility: 'public' }
  // Compatibility: `--team` alone remains Team-only.
  if (options.team !== undefined) return { visibility: 'team' }

  // No flag: the disclosure is a real decision, so it must be asked. In a
  // non-interactive Team Project, Team-only is the sole fail-closed default.
  // Personal Projects still require an explicit disclosure.
  if (!ui.interactive) {
    if (ownerTeam !== undefined) return { visibility: 'team' }
    ui.error('Choose a disclosure: `--team <name-or-id>`, `--link-only`, or `--public`.')
    return null
  }

  const choices = [
    ...(ownerTeam === undefined
      ? []
      : [
          {
            value: 'team',
            label: `Team · ${ownerTeam.name ?? ownerTeam.id}`,
            hint: 'current Team members only',
          },
        ]),
    { value: 'link-only', label: 'Link-only', hint: 'anyone with the URL can read' },
    { value: 'public', label: 'Public', hint: 'can appear in Explore and search' },
  ]
  const selected = await ui.select({
    message: 'How should auto-published Sessions be shared?',
    choices,
    // Never preselect Public: the safest listed disclosure leads.
    initialValue: choices[0]!.value,
  })
  if (selected === null) {
    ui.cancel('Nothing subscribed.')
    return null
  }
  return { visibility: selected as SubscriptionVisibility }
}

interface TeamOwner {
  id: string
  name?: string
}

async function resolveRequestedTeam(
  ui: CliUi,
  reference: string | undefined,
  dependencies: SubscribeCommandDependencies,
): Promise<HubTeam | null | undefined> {
  if (reference === undefined) return undefined
  const teams = await (dependencies.listTeams ?? (() => listTeamsFromHub(dependencies)))()
  const wanted = reference.trim()
  const team = resolveTeamReference(teams, wanted)
  if (team) return team
  ui.error(
    teams.length === 0
      ? 'You are not a member of any Team (or you are not logged in).'
      : `No Team matches "${wanted}". Your Teams: ${teams.map((entry) => entry.name).join(', ')}`,
  )
  return null
}

async function listTeamsFromHub(dependencies: SubscribeCommandDependencies): Promise<HubTeam[]> {
  const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
  if (!credentials.token) return []
  const client = new HubClient({
    hubUrl: credentials.hubUrl,
    token: credentials.token,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  })
  return client.listTeams()
}

function teamOwnerFromProject(project: HubProject): TeamOwner | undefined {
  if (project.owner.kind !== 'team') return undefined
  const name = project.owner.name ?? project.owner.handle
  return { id: project.owner.id, ...(name === null ? {} : { name }) }
}

function projectReference(project: HubProject): string {
  return `${project.owner.handle ?? project.owner.id}/${project.slug}`
}

function disclosureCopy(
  target: VisibilityTarget,
  ownerTeam: TeamOwner | undefined,
  projectDescription: string,
): string {
  const ownership =
    ownerTeam === undefined
      ? `${projectDescription} is owned by your account.`
      : `${projectDescription} is owned by Team · ${ownerTeam.name ?? ownerTeam.id}.`
  switch (target.visibility) {
    case 'team':
      return (
        `Sessions from this directory and its worktrees will auto-publish as Team-only. ` +
        `Only current members can read them. ${ownership}`
      )
    case 'link-only':
      return (
        'Sessions from this directory and its worktrees will auto-publish as Link-only. ' +
        `Anyone with the URL can read them. ${ownership}`
      )
    case 'public':
      return (
        'Sessions from this directory and its worktrees will auto-publish as Public. ' +
        `They can appear in Explore and search. ${ownership}`
      )
  }
}

export async function handleUnsubscribeCommand(
  directory: string | undefined,
  dependencies: SubscribeCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  const cwd = dependencies.cwd ?? process.cwd()
  ui.intro('Unsubscribe a directory')
  try {
    const credentialOptions = pickCredentialOptions(dependencies)
    const input = directory ?? cwd
    let path: string
    try {
      path = canonicalSubscriptionPath(input, cwd)
    } catch {
      // A deleted directory must still be unsubscribable by its stored path.
      path = input
    }
    let { removed } = removeSubscription(path, credentialOptions)
    if (!removed && path !== input) {
      removed = removeSubscription(input, credentialOptions).removed
    }
    if (!removed) {
      ui.warn(`Not subscribed: ${path}`)
      ui.outro('Nothing changed.')
      return 1
    }
    ui.success(`Unsubscribed ${path}. Already-published sessions stay live.`)
    ui.outro(`Use \`${formatCliCommand('withdraw')}\` to take a published session down.`)
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export function handleSubscriptionsCommand(dependencies: SubscribeCommandDependencies = {}): 0 | 1 {
  const ui = dependencies.ui ?? createTextUi()
  try {
    const subscriptions = loadSubscriptions(pickCredentialOptions(dependencies))
    if (subscriptions.length === 0) {
      ui.info(`No subscribed directories. Add one with \`${formatCliCommand('subscribe')}\`.`)
      return 0
    }
    for (const subscription of subscriptions) {
      ui.info(`${subscription.path}  (${subscriptionLabel(subscription)})`)
    }
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export function subscriptionLabel(subscription: Subscription): string {
  const project = subscription.project
    ? ` · Project ${projectReference(subscription.project.remote)}`
    : ' · Project not configured'
  const owner =
    subscription.teamId === undefined
      ? ''
      : ` · Team · ${subscription.teamName ?? subscription.teamId}`
  switch (subscription.visibility) {
    case 'team':
      return `Team-only${owner}${project}`
    case 'link-only':
      return `Link-only${owner}${project}`
    case 'public':
      return `Public${owner}${project}`
  }
}

export const subscribeCommand = new Command('subscribe')
  .description('Auto-publish sessions from a directory and its worktrees')
  .argument('[dir]', 'Directory to subscribe; defaults to the current directory')
  .option(
    '--team <handle-name-or-id>',
    'Own subscribed sessions as this Team (Team-only unless --public or --link-only)',
  )
  .option('--link-only', 'Publish subscribed sessions as Link-only')
  .option('--public', 'Publish subscribed sessions as Public (explicit opt-in)')
  .option('--project <id-or-owner-slug>', 'Bind to this Hub Project')
  .option('--create-project <name>', 'Create and bind a Hub Project')
  .option('--yes', 'Skip the one-time visibility confirmation')
  .action(
    async (
      dir: string | undefined,
      opts: {
        team?: string
        linkOnly?: boolean
        public?: boolean
        yes?: boolean
        project?: string
        createProject?: string
      },
    ) => {
      const exitCode = await handleSubscribeCommand(
        dir,
        {
          ...(opts.team === undefined ? {} : { team: opts.team }),
          ...(opts.linkOnly === undefined ? {} : { linkOnly: opts.linkOnly }),
          ...(opts.public === undefined ? {} : { public: opts.public }),
          ...(opts.yes === undefined ? {} : { yes: opts.yes }),
          ...(opts.project === undefined ? {} : { project: opts.project }),
          ...(opts.createProject === undefined ? {} : { createProject: opts.createProject }),
        },
        { ui: createClackUi() },
      )
      if (exitCode !== 0) process.exitCode = exitCode
    },
  )

export const unsubscribeCommand = new Command('unsubscribe')
  .description('Stop auto-publishing sessions from a subscribed directory')
  .argument('[dir]', 'Directory to unsubscribe; defaults to the current directory')
  .action(async (dir: string | undefined) => {
    const exitCode = await handleUnsubscribeCommand(dir, { ui: createClackUi() })
    if (exitCode !== 0) process.exitCode = exitCode
  })

export const subscriptionsCommand = new Command('subscriptions')
  .description('List directories subscribed for auto-publishing')
  .action(() => {
    const exitCode = handleSubscriptionsCommand({ ui: createClackUi() })
    if (exitCode !== 0) process.exitCode = exitCode
  })

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

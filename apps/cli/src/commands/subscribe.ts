import {
  formatCliCommand,
  getDB,
  resolveLocalProjectIdentity,
  type ProjectIdentity,
} from '@spool-lab/core'
import { Command } from 'commander'

import { HubClient, type HubFetch, type HubProjectsResponse, type HubTeam } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { persistResolvedProject, resolveHubProject } from '../hub/project-resolution.js'
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
// disclosure target is always an explicit choice among Team, Link-only, and
// Public; there is no implicit default and Public is never preselected.

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
  teamId?: string
  teamName?: string
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
    const flagCount = [options.team, options.linkOnly, options.public].filter(
      (value) => value !== undefined && value !== false,
    ).length
    if (flagCount > 1) {
      ui.error('Pick exactly one of `--team`, `--link-only`, or `--public`.')
      return 1
    }
    if (options.project !== undefined && options.createProject !== undefined) {
      ui.error('`--project` and `--create-project` cannot be used together.')
      return 1
    }

    const path = canonicalSubscriptionPath(directory ?? cwd, cwd)
    const target = await resolveVisibilityTarget(ui, options, dependencies)
    if (target === null) return 1

    if (options.yes !== true) {
      if (!ui.interactive) {
        ui.error('Cannot confirm auto-publish visibility without a TTY. Re-run with `--yes`.')
        return 1
      }
      ui.info(disclosureCopy(target))
      const approved = await ui.confirm(`Subscribe ${path}?`, true)
      if (approved !== true) {
        ui.cancel('Nothing subscribed.')
        return 1
      }
    } else {
      ui.info(disclosureCopy(target))
    }

    const credentialOptions = pickCredentialOptions(dependencies)
    const credentials = loadHubCredentials(credentialOptions)
    if (!credentials.token) {
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
    const resolvedProject = await resolveHubProject({
      client,
      ui,
      hubUrl: credentials.hubUrl,
      localIdentity,
      tenant:
        target.visibility === 'team' && target.teamId
          ? { kind: 'team', id: target.teamId }
          : { kind: 'personal' },
      ...(options.project === undefined ? {} : { projectRef: options.project }),
      ...(options.createProject === undefined ? {} : { createProjectName: options.createProject }),
      ...(dependencies.listProjects === undefined
        ? {}
        : { listResponse: await dependencies.listProjects() }),
      ...credentialOptions,
    })
    if (!resolvedProject) return 1

    const subscription: Subscription = {
      path,
      visibility: target.visibility,
      ...(target.teamId === undefined ? {} : { teamId: target.teamId }),
      ...(target.teamName === undefined ? {} : { teamName: target.teamName }),
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
  dependencies: SubscribeCommandDependencies,
): Promise<VisibilityTarget | null> {
  if (options.linkOnly === true) return { visibility: 'link-only' }
  if (options.public === true) return { visibility: 'public' }

  const listTeams = dependencies.listTeams ?? (() => listTeamsFromHub(dependencies))

  if (options.team !== undefined) {
    const teams = await listTeams()
    const wanted = options.team.trim()
    const team = resolveTeamReference(teams, wanted)
    if (!team) {
      ui.error(
        teams.length === 0
          ? 'You are not a member of any Team (or you are not logged in).'
          : `No Team matches "${wanted}". Your Teams: ${teams.map((entry) => entry.name).join(', ')}`,
      )
      return null
    }
    return { visibility: 'team', teamId: team.id, teamName: team.name }
  }

  // No flag: the disclosure is a real decision, so it must be asked. In a
  // non-interactive context there is nothing safe to assume.
  if (!ui.interactive) {
    ui.error('Choose a disclosure: `--team <name-or-id>`, `--link-only`, or `--public`.')
    return null
  }

  let teams: HubTeam[] = []
  try {
    teams = await listTeams()
  } catch {
    ui.warn('Could not load your Teams; log in with `spool login` to target a Team.')
  }
  const choices = [
    ...teams.map((team) => ({
      value: `team:${team.id}`,
      label: `Team · ${team.name}`,
      hint: 'current members only; the Team owns the Sessions',
    })),
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
  if (selected.startsWith('team:')) {
    const teamId = selected.slice('team:'.length)
    const team = teams.find((entry) => entry.id === teamId)
    return { visibility: 'team', teamId, ...(team === undefined ? {} : { teamName: team.name }) }
  }
  return { visibility: selected as 'public' | 'link-only' }
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

function disclosureCopy(target: VisibilityTarget): string {
  switch (target.visibility) {
    case 'team':
      return (
        `Sessions from this directory and its worktrees will auto-publish to Team · ${target.teamName ?? target.teamId}. ` +
        'Only current members can read them, and the Team owns the resulting Sessions.'
      )
    case 'link-only':
      return 'Sessions from this directory and its worktrees will auto-publish as Link-only. Anyone with the URL can read them.'
    case 'public':
      return 'Sessions from this directory and its worktrees will auto-publish as Public. They can appear in Explore and search.'
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
    ? ` · Project ${subscription.project.remote.name}`
    : ' · Project not configured'
  switch (subscription.visibility) {
    case 'team':
      return `Team · ${subscription.teamName ?? subscription.teamId ?? 'unknown'}${project}`
    case 'link-only':
      return `Link-only${project}`
    case 'public':
      return `Public${project}`
  }
}

export const subscribeCommand = new Command('subscribe')
  .description('Auto-publish sessions from a directory and its worktrees')
  .argument('[dir]', 'Directory to subscribe; defaults to the current directory')
  .option('--team <handle-name-or-id>', 'Publish subscribed sessions to this Team')
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

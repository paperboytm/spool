import { formatCliCommand, formatCliInstallHint } from '@spool-lab/core'
import { Command } from 'commander'

import { HubClient, HubHttpError, type HubFetch, type HubTeam } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { resolveSessionRef } from '../hub/ref.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// Disclosure changes are named, confirmed actions (DESIGN.md): moving a
// published Session between Team, Link-only, and Public without re-pushing
// records. Team → Public keeps Team ownership; Public → Team removes all
// public discovery projections server-side before completing.

const TARGETS = ['public', 'link-only', 'team'] as const
export type VisibilityTargetName = (typeof TARGETS)[number]

export interface VisibilityCommandOptions {
  team?: string
  yes?: boolean
}

export interface VisibilityCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  ui?: CliUi
  listTeams?: (client: HubClient) => Promise<HubTeam[]>
}

export async function handleVisibilityCommand(
  input: string,
  target: string,
  options: VisibilityCommandOptions,
  dependencies: VisibilityCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  ui.intro('Change session visibility')
  try {
    if (!TARGETS.includes(target as VisibilityTargetName)) {
      ui.error(`Unknown visibility "${target}". Choose one of: ${TARGETS.join(', ')}.`)
      return 1
    }
    const visibility = target as VisibilityTargetName
    const ref = resolveSessionRef(input)

    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      ui.info(formatCliInstallHint())
      return 1
    }
    const client = new HubClient({
      hubUrl: ref.hubUrl ?? credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })

    let teamId: string | undefined
    let teamName: string | undefined
    if (visibility === 'team') {
      const listTeams = dependencies.listTeams ?? ((forClient) => forClient.listTeams())
      const teams = await listTeams(client)
      if (options.team !== undefined) {
        const wanted = options.team.trim()
        const team = teams.find((entry) => entry.id === wanted || entry.name === wanted)
        if (!team) {
          ui.error(
            teams.length === 0
              ? 'You are not a member of any Team.'
              : `No Team matches "${options.team}". Your Teams: ${teams.map((entry) => entry.name).join(', ')}`,
          )
          return 1
        }
        teamId = team.id
        teamName = team.name
      } else if (teams.length === 1 && teams[0]) {
        teamId = teams[0].id
        teamName = teams[0].name
      } else if (ui.interactive && teams.length > 1) {
        const selected = await ui.select({
          message: 'Which Team should own this Session?',
          choices: teams.map((team) => ({ value: team.id, label: `Team · ${team.name}` })),
        })
        if (selected === null) {
          ui.cancel('Visibility unchanged.')
          return 1
        }
        teamId = selected
        teamName = teams.find((team) => team.id === selected)?.name
      } else {
        ui.error('Pass `--team <name-or-id>` to choose the target Team.')
        return 1
      }
    }

    const confirmation = confirmationCopy(visibility, teamName ?? teamId)
    if (options.yes !== true) {
      if (!ui.interactive) {
        ui.error('Cannot confirm a disclosure change without a TTY. Re-run with `--yes`.')
        return 1
      }
      const approved = await ui.confirm(confirmation, true)
      if (approved !== true) {
        ui.cancel('Visibility unchanged.')
        return 1
      }
    } else {
      ui.info(confirmation)
    }

    const session = await client.updateSessionVisibility(ref.sid, visibility, teamId)
    ui.success(`Session ${ref.sid} is now ${describeVisibility(session)}.`)
    ui.outro('Disclosure updated.')
    return 0
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      ui.error(friendlyHubError(cause, input))
      if (cause.status === 401) ui.info(formatCliInstallHint())
    } else {
      ui.error(cause instanceof Error ? cause.message : String(cause))
    }
    return 1
  }
}

function confirmationCopy(visibility: VisibilityTargetName, teamLabel?: string): string {
  switch (visibility) {
    case 'public':
      return 'Make this Session Public? It can appear in Explore, search, and your Profile; a Team-owned Session stays owned by the Team.'
    case 'link-only':
      return 'Make this Session Link-only? Anyone with the URL can read it, and it leaves Explore and search.'
    case 'team':
      return `Move this Session to Team · ${teamLabel ?? 'unknown'}? Only current members can read it, the Team owns it from now on, and any public discovery is removed.`
  }
}

function describeVisibility(session: {
  visibility: 'public' | 'link-only' | 'team'
  team_name: string | null
  team_id: string | null
}): string {
  if (session.visibility === 'team') {
    return `Team · ${session.team_name ?? session.team_id ?? 'unknown'} only`
  }
  return session.visibility === 'public' ? 'Public' : 'Link-only'
}

function friendlyHubError(error: HubHttpError, sid: string): string {
  if (error.status === 401) {
    return `Authentication failed. Run \`${formatCliCommand('login')}\` to update your hub token.`
  }
  if (error.status === 403) {
    return 'Only Team Owners or Admins can change a Team-owned Session’s disclosure.'
  }
  if (error.status === 404) return `Session not found: ${sid}`
  if (error.status === 410) return `Session already withdrawn: ${sid}`
  if (error.status === 422) return `The hub rejected this change: ${error.bodyMessage}`
  return `Hub returned HTTP ${error.status}: ${error.bodyMessage}`
}

export const visibilityCommand = new Command('visibility')
  .description('Change a published session’s disclosure (Team, Link-only, or Public)')
  .argument('<sid|url>', 'Shared session ID or URL')
  .argument('<target>', `One of: ${TARGETS.join(', ')}`)
  .option('--team <name-or-id>', 'Target Team when moving a session to a Team')
  .option('--yes', 'Skip the confirmation')
  .action(async (input: string, target: string, opts: { team?: string; yes?: boolean }) => {
    const exitCode = await handleVisibilityCommand(
      input,
      target,
      {
        ...(opts.team === undefined ? {} : { team: opts.team }),
        ...(opts.yes === undefined ? {} : { yes: opts.yes }),
      },
      { ui: createClackUi() },
    )
    if (exitCode !== 0) process.exitCode = exitCode
  })

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

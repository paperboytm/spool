import { formatCliCommand, formatCliInstallHint } from '@spool-lab/core'
import { Command } from 'commander'

import { HubClient, type HubFetch, type HubTeam } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

// Read-only: the Teams the signed-in user belongs to. Stable handles are the
// preferred CLI reference; a unique display name remains a convenience.

export interface TeamsCommandOptions {
  json?: boolean
}

export interface TeamsCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  ui?: CliUi
  log?: (message: string) => void
  listTeams?: () => Promise<HubTeam[]>
}

export async function handleTeamsCommand(
  options: TeamsCommandOptions,
  dependencies: TeamsCommandDependencies = {},
): Promise<0 | 1> {
  const ui = dependencies.ui ?? createTextUi()
  const log = dependencies.log ?? console.log
  try {
    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      ui.error(`Not logged in. Run \`${formatCliCommand('login')}\` first.`)
      ui.info(formatCliInstallHint())
      return 1
    }
    const listTeams =
      dependencies.listTeams ??
      (() =>
        new HubClient({
          hubUrl: credentials.hubUrl,
          token: credentials.token as string,
          ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
        }).listTeams())
    const teams = await listTeams()

    if (options.json === true) {
      log(JSON.stringify(teams, null, 2))
      return 0
    }
    if (teams.length === 0) {
      ui.info('You are not a member of any Team. Create one on spool.new.')
      return 0
    }
    for (const team of teams) {
      const members = `${team.member_count} member${team.member_count === 1 ? '' : 's'}`
      const handle = team.handle ? `  @${team.handle}` : ''
      ui.info(`Team · ${team.name}${handle}  (${team.role}, ${members})`)
    }
    ui.info(
      `Use a handle with \`${formatCliCommand('subscribe --team <handle>')}\`, \`${formatCliCommand('share --team <handle>')}\`, or \`${formatCliCommand('visibility <sid> team --team <handle>')}\`.`,
    )
    return 0
  } catch (cause) {
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return 1
  }
}

export const teamsCommand = new Command('teams')
  .description('List the Teams you belong to')
  .option('--json', 'Machine-readable output')
  .action(async (opts: { json?: boolean }) => {
    const exitCode = await handleTeamsCommand(
      { ...(opts.json === undefined ? {} : { json: opts.json }) },
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

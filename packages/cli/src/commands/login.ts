import { Command } from 'commander'
import { createInterface } from 'node:readline/promises'
import {
  loadHubCredentials,
  saveHubCredentials,
  type HubCredentialOptions,
} from '../hub/credentials.js'

export interface LoginCommandOptions {
  token?: string
}

export interface LoginCommandDependencies extends HubCredentialOptions {
  promptToken?: () => Promise<string>
  log?: (message: string) => void
  error?: (message: string) => void
}

export async function handleLoginCommand(
  options: LoginCommandOptions,
  dependencies: LoginCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error

  try {
    const token = (options.token ?? await (dependencies.promptToken ?? promptForHubToken)()).trim()
    if (token === '') {
      error('Hub token cannot be empty.')
      return 1
    }

    const credentialOptions = pickCredentialOptions(dependencies)
    const { hubUrl } = loadHubCredentials(credentialOptions)
    const path = saveHubCredentials({ hubUrl, token }, credentialOptions)
    log(`You saved hub credentials to ${path}.`)
    return 0
  } catch (cause) {
    error(`Could not save hub credentials: ${errorMessage(cause)}`)
    return 1
  }
}

export const loginCommand = new Command('login')
  .description('Save credentials for the Spool hub')
  .option('--token <t>', 'Hub API token')
  .action(async (options: LoginCommandOptions) => {
    const exitCode = await handleLoginCommand(options)
    if (exitCode !== 0) process.exitCode = exitCode
  })

async function promptForHubToken(): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return await readline.question('Hub API token: ')
  } finally {
    readline.close()
  }
}

function pickCredentialOptions(
  dependencies: HubCredentialOptions,
): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

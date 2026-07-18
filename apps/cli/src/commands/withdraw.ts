import { Command } from 'commander'

import { HubClient, HubHttpError, type HubFetch } from '../hub/client.js'
import { loadHubCredentials, type HubCredentialOptions } from '../hub/credentials.js'
import { resolveSessionRef } from '../hub/ref.js'

export interface WithdrawCommandDependencies extends HubCredentialOptions {
  fetch?: HubFetch
  log?: (message: string) => void
  error?: (message: string) => void
}

export async function handleWithdrawCommand(
  input: string,
  dependencies: WithdrawCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  let resolvedSid: string | undefined

  try {
    const ref = resolveSessionRef(input)
    resolvedSid = ref.sid
    const credentials = loadHubCredentials(pickCredentialOptions(dependencies))
    if (!credentials.token) {
      error('Not logged in. Run `spool login` first.')
      return 1
    }

    const client = new HubClient({
      hubUrl: ref.hubUrl ?? credentials.hubUrl,
      token: credentials.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })
    await client.withdrawSession(ref.sid)
    log(`You withdrew session ${ref.sid}.`)
    return 0
  } catch (cause) {
    if (cause instanceof HubHttpError) {
      error(friendlyHubError(cause, resolvedSid ?? input))
    } else {
      error(errorMessage(cause))
    }
    return 1
  }
}

export const withdrawCommand = new Command('withdraw')
  .description('Withdraw a shared session from the Spool hub')
  .argument('<sid|url>', 'Shared session ID or URL')
  .action(async (input: string) => {
    const exitCode = await handleWithdrawCommand(input)
    if (exitCode !== 0) process.exitCode = exitCode
  })

function friendlyHubError(error: HubHttpError, sid: string): string {
  if (error.status === 401) {
    return 'Authentication failed. Run `spool login` to update your hub token.'
  }

  if (error.status === 404) return `Session not found: ${sid}`
  if (error.status === 410) return `Session already withdrawn: ${sid}`
  return `Hub returned HTTP ${error.status}: ${error.bodyMessage}`
}

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

import { Command } from 'commander'
import { HubClient, HubHttpError, type HubFetch } from '../hub/client.js'
import {
  clearHubCredentials,
  hubCredentialsPath,
  loadStoredHubCredentials,
  type HubCredentialOptions,
} from '../hub/credentials.js'

// `spool logout` = the inverse of login: revoke this machine's token on
// the hub (best-effort — an unreachable hub must not wedge local
// sign-out), then delete ~/.spool/hub-credentials.json. Operates on the
// stored file only; a SPOOL_HUB_TOKEN env override is the caller's to
// unset, so we just point it out.

export interface LogoutCommandDependencies extends HubCredentialOptions {
  log?: (message: string) => void
  error?: (message: string) => void
  fetch?: HubFetch
}

export async function handleLogoutCommand(
  dependencies: LogoutCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const credentialOptions = pickCredentialOptions(dependencies)

  try {
    const stored = loadStoredHubCredentials(credentialOptions)
    if (stored === undefined) {
      error(`Not logged in (no credentials at ${hubCredentialsPath(credentialOptions)}).`)
      return 1
    }

    const client = new HubClient({
      hubUrl: stored.hubUrl,
      token: stored.token,
      ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    })
    try {
      await client.revokeToken()
      log(`You revoked this machine's token on ${stored.hubUrl}.`)
    } catch (cause) {
      if (cause instanceof HubHttpError && cause.status === 401) {
        // Already dead on the hub — logout still succeeds locally.
        log('The hub had already invalidated this token.')
      } else {
        error(
          `Warning: could not revoke the token on ${stored.hubUrl} (${errorMessage(cause)}). `
          + 'Removing local credentials anyway — revoke it from your account page if needed.',
        )
      }
    }

    const removed = clearHubCredentials(credentialOptions)
    if (removed !== undefined) log(`You signed out; removed ${removed}.`)

    const env = credentialOptions.env ?? process.env
    if (env['SPOOL_HUB_TOKEN']?.trim()) {
      log('Note: SPOOL_HUB_TOKEN is set in your environment and still wins — unset it to fully sign out.')
    }
    return 0
  } catch (cause) {
    error(`Logout failed: ${errorMessage(cause)}`)
    return 1
  }
}

export const logoutCommand = new Command('logout')
  .description('Sign out of the Spool hub: revoke this machine\'s token and delete local credentials')
  .action(async () => {
    const exitCode = await handleLogoutCommand()
    if (exitCode !== 0) process.exitCode = exitCode
  })

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

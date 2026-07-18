import { spawn } from 'node:child_process'
import { hostname } from 'node:os'

import { Command } from 'commander'

import {
  HubClient,
  HubHttpError,
  type HubCliAuthPollResponse,
  type HubFetch,
} from '../hub/client.js'
import {
  loadHubCredentials,
  saveHubCredentials,
  type HubCredentialOptions,
} from '../hub/credentials.js'

// `spool login` = self-hosted device flow: ask the hub for a
// device_code/user_code pair, send the user to the approval page in a
// browser (any browser — the poll loop below is what receives the
// token, so this works over SSH too), then poll until approved.
// `--token` skips all of that for CI and scripted setups.

export interface LoginCommandOptions {
  token?: string
}

export interface LoginCommandDependencies extends HubCredentialOptions {
  log?: (message: string) => void
  error?: (message: string) => void
  fetchImpl?: HubFetch
  openBrowser?: (url: string) => Promise<boolean>
  sleep?: (ms: number) => Promise<void>
  /** Shown on the approval page; defaults to the machine hostname. */
  label?: string
}

export async function handleLoginCommand(
  options: LoginCommandOptions,
  dependencies: LoginCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const credentialOptions = pickCredentialOptions(dependencies)

  try {
    const { hubUrl } = loadHubCredentials(credentialOptions)

    let token: string
    if (options.token !== undefined) {
      token = options.token.trim()
      if (token === '') {
        error('Hub token cannot be empty.')
        return 1
      }
    } else {
      token = await browserLogin(hubUrl, dependencies, log)
    }

    const path = saveHubCredentials({ hubUrl, token }, credentialOptions)
    log(`You saved hub credentials to ${path}.`)
    return 0
  } catch (cause) {
    error(`Login failed: ${errorMessage(cause)}`)
    return 1
  }
}

async function browserLogin(
  hubUrl: string,
  dependencies: LoginCommandDependencies,
  log: (message: string) => void,
): Promise<string> {
  const client = new HubClient({
    hubUrl,
    ...(dependencies.fetchImpl === undefined ? {} : { fetch: dependencies.fetchImpl }),
  })
  const sleep = dependencies.sleep ?? defaultSleep
  const openBrowser = dependencies.openBrowser ?? defaultOpenBrowser
  const label = dependencies.label ?? hostname()

  const start = await client.startCliAuth(label)
  log(`Confirm this code in your browser: ${start.user_code}`)
  const opened = await openBrowser(start.verification_uri)
  log(
    opened
      ? `Opening ${start.verification_uri}`
      : `Open this URL in a browser to approve: ${start.verification_uri}`,
  )
  log('Waiting for approval…')

  const deadline = Date.now() + start.expires_in * 1000
  let intervalMs = Math.max(1, start.interval) * 1000
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    let poll: HubCliAuthPollResponse
    try {
      poll = await client.pollCliAuth(start.device_code)
    } catch (cause) {
      if (cause instanceof HubHttpError && cause.status === 404) {
        throw new Error('the sign-in request expired or was denied in the browser.')
      }
      if (cause instanceof HubHttpError && cause.status === 429) {
        // RFC 8628 slow_down semantics: back off and keep going.
        intervalMs *= 2
      }
      // Transient network/server hiccups keep polling until the deadline.
      continue
    }
    if (poll.status === 'approved' && poll.token !== undefined) return poll.token
  }
  throw new Error('timed out waiting for browser approval. Run `spool login` again.')
}

export const loginCommand = new Command('login')
  .description('Sign in to the Spool hub via your browser (or --token to paste one)')
  .option('--token <t>', 'Hub API token (skips the browser flow)')
  .action(async (options: LoginCommandOptions) => {
    const exitCode = await handleLoginCommand(options)
    if (exitCode !== 0) process.exitCode = exitCode
  })

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultOpenBrowser(url: string): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => resolve(false))
    child.on('spawn', () => {
      child.unref()
      resolve(true)
    })
  })
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

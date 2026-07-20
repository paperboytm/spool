import { spawn } from 'node:child_process'
import { hostname } from 'node:os'

import { formatCliCommand } from '@spool-lab/core'
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
import { createClackUi, createTextUi, type CliUi } from '../ui.js'

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
  ui?: CliUi
}

export async function handleLoginCommand(
  options: LoginCommandOptions,
  dependencies: LoginCommandDependencies = {},
): Promise<0 | 1> {
  const log = dependencies.log ?? console.log
  const error = dependencies.error ?? console.error
  const ui = dependencies.ui ?? createTextUi(log, error)
  const credentialOptions = pickCredentialOptions(dependencies)
  ui.intro('Sign in to Spool')

  try {
    const { hubUrl } = loadHubCredentials(credentialOptions)

    let token: string
    if (options.token !== undefined) {
      token = options.token.trim()
      if (token === '') {
        ui.error('Hub token cannot be empty.')
        return 1
      }
    } else {
      token = await browserLogin(hubUrl, dependencies, ui)
    }

    const path = saveHubCredentials({ hubUrl, token }, credentialOptions)
    ui.outro(`Signed in. Credentials saved to ${path}.`)
    return 0
  } catch (cause) {
    ui.error(`Login failed: ${errorMessage(cause)}`)
    return 1
  }
}

async function browserLogin(
  hubUrl: string,
  dependencies: LoginCommandDependencies,
  ui: CliUi,
): Promise<string> {
  const client = new HubClient({
    hubUrl,
    ...(dependencies.fetchImpl === undefined ? {} : { fetch: dependencies.fetchImpl }),
  })
  const sleep = dependencies.sleep ?? defaultSleep
  const openBrowser = dependencies.openBrowser ?? defaultOpenBrowser
  const label = dependencies.label ?? hostname()

  const start = await client.startCliAuth(label)
  ui.note(`${start.user_code}\n${start.verification_uri}`, 'Confirm this device in your browser')
  const opened = await openBrowser(start.verification_uri)
  if (!opened) ui.info('The browser could not be opened automatically; use the URL above.')
  const waiting = ui.spinner()
  waiting.start('Waiting for browser approval')

  const deadline = Date.now() + start.expires_in * 1000
  let intervalMs = Math.max(1, start.interval) * 1000
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    let poll: HubCliAuthPollResponse
    try {
      poll = await client.pollCliAuth(start.device_code)
    } catch (cause) {
      if (cause instanceof HubHttpError && cause.status === 404) {
        waiting.error('Browser approval expired or was denied')
        throw new Error('the sign-in request expired or was denied in the browser.')
      }
      if (cause instanceof HubHttpError && cause.status === 429) {
        // RFC 8628 slow_down semantics: back off and keep going.
        intervalMs *= 2
        waiting.message('The Hub asked us to slow down; still waiting for approval')
      }
      // Transient network/server hiccups keep polling until the deadline.
      continue
    }
    if (poll.status === 'approved' && poll.token !== undefined) {
      waiting.stop('Browser approval received')
      return poll.token
    }
  }
  waiting.error('Timed out waiting for browser approval')
  throw new Error(
    `timed out waiting for browser approval. Run \`${formatCliCommand('login')}\` again.`,
  )
}

export const loginCommand = new Command('login')
  .description('Sign in to the Spool hub via your browser (or --token to paste one)')
  .option('--token <t>', 'Hub API token (skips the browser flow)')
  .action(async (options: LoginCommandOptions) => {
    const exitCode = await handleLoginCommand(options, { ui: createClackUi() })
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

import { readFileSync } from 'node:fs'

import { SpoolWatcher, formatCliCommand } from '@spool-lab/core'
import { Command } from 'commander'

import {
  clearHeartbeat,
  daemonLogPath,
  daemonRuntimeStatus,
  installDaemonService,
  readHeartbeat,
  uninstallDaemonService,
  writeHeartbeat,
  type DaemonServiceDeps,
} from '../daemon/service.js'
import { runAutoPublish } from '../hub/auto-publish.js'
import type { HubCredentialOptions } from '../hub/credentials.js'
import { loadSubscriptions } from '../subscriptions.js'
import { createClackUi, createTextUi, type CliUi } from '../ui.js'
import { subscriptionLabel } from './subscribe.js'
import { createAutoPublisher, syncLocalSessions } from './sync.js'

// `spool daemon` owns the always-on loop: index new provider records as they
// land, then auto-publish every subscribed directory. start/stop delegate
// supervision to launchd/systemd; run is the foreground loop those services
// (and debugging users) execute.

export function handleDaemonStart(dependencies: DaemonServiceDeps = {}, ui?: CliUi): 0 | 1 {
  const output = ui ?? createTextUi()
  output.intro('Start the Spool daemon')
  if (loadSubscriptions(pickCredentialOptions(dependencies)).length === 0) {
    output.warn(
      `No subscribed directories yet — the daemon will only index locally. Add one with \`${formatCliCommand('subscribe')}\`.`,
    )
  }
  const result = installDaemonService(dependencies)
  if (!result.ok) {
    output.error(result.message)
    return 1
  }
  output.success(result.message)
  output.outro(`Check it with \`${formatCliCommand('daemon status')}\`.`)
  return 0
}

export function handleDaemonStop(dependencies: DaemonServiceDeps = {}, ui?: CliUi): 0 | 1 {
  const output = ui ?? createTextUi()
  output.intro('Stop the Spool daemon')
  const result = uninstallDaemonService(dependencies)
  if (!result.ok) {
    output.error(result.message)
    return 1
  }
  output.success(result.message)
  output.outro('Daemon stopped.')
  return 0
}

export function handleDaemonStatus(
  dependencies: DaemonServiceDeps & { isAlive?: (pid: number) => boolean } = {},
  ui?: CliUi,
): 0 | 1 {
  const output = ui ?? createTextUi()
  const credentialOptions = pickCredentialOptions(dependencies)
  const status = dependencies.isAlive
    ? daemonRuntimeStatus(credentialOptions, dependencies.isAlive)
    : daemonRuntimeStatus(credentialOptions)
  if (status.running && status.heartbeat) {
    output.success(
      `Daemon running (pid ${status.heartbeat.pid}, since ${status.heartbeat.startedAt}).`,
    )
    output.info(
      status.heartbeat.lastPassAt
        ? `Last publish pass: ${status.heartbeat.lastPassAt}`
        : 'No publish pass completed yet.',
    )
  } else {
    output.warn(`Daemon not running. Start it with \`${formatCliCommand('daemon start')}\`.`)
  }

  const subscriptions = loadSubscriptions(credentialOptions)
  if (subscriptions.length === 0) {
    output.info('No subscribed directories.')
  } else {
    for (const subscription of subscriptions) {
      output.info(`${subscription.path}  (${subscriptionLabel(subscription)})`)
    }
  }
  output.info(`Logs: ${daemonLogPath(credentialOptions)}`)
  return status.running || subscriptions.length === 0 ? 0 : 1
}

export function handleDaemonLogs(
  lines: number,
  dependencies: HubCredentialOptions = {},
  ui?: CliUi,
): 0 | 1 {
  const output = ui ?? createTextUi()
  const path = daemonLogPath(pickCredentialOptions(dependencies))
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    output.info(`No daemon log at ${path} yet.`)
    return 0
  }
  const all = content.split('\n')
  const tail = all.slice(Math.max(0, all.length - lines - 1))
  for (const line of tail) {
    if (line !== '') output.info(line)
  }
  return 0
}

/** Foreground daemon loop. Blocks until SIGINT/SIGTERM. */
export function runDaemonLoop(
  ui: CliUi,
  dependencies: HubCredentialOptions & { now?: () => string } = {},
): 0 | 1 {
  const credentialOptions = pickCredentialOptions(dependencies)
  const now = dependencies.now ?? (() => new Date().toISOString())
  const existing = readHeartbeat(credentialOptions)
  ui.intro('Spool daemon')

  const syncer = syncLocalSessions(ui)
  if (syncer === null) return 1

  const startedAt = now()
  const heartbeat = () => ({ pid: process.pid, startedAt })
  writeHeartbeat(heartbeat(), credentialOptions)
  if (existing) {
    ui.info(`Replacing previous daemon heartbeat (pid ${existing.pid}).`)
  }

  const autoPublish = createAutoPublisher(ui, {
    run: async (forUi) => {
      const result = await runAutoPublish(forUi, credentialOptions)
      writeHeartbeat({ ...heartbeat(), lastPassAt: now() }, credentialOptions)
      return result
    },
  })

  const watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    ui.info(`${data.count} new session${data.count === 1 ? '' : 's'} indexed`)
    void autoPublish()
  })
  watcher.on('error', (_event, data) => {
    ui.error(`Watcher error: ${data.error}${data.root === undefined ? '' : ` (root=${data.root})`}`)
  })
  watcher.start()
  ui.info('Watching for new sessions. Press Ctrl+C to stop.')
  void autoPublish()

  const shutdown = () => {
    watcher.stop()
    clearHeartbeat(credentialOptions)
    ui.outro('Daemon stopped.')
    process.exitCode = 0
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  return 0
}

export const daemonCommand = new Command('daemon').description(
  'Run and manage the background publisher for subscribed directories',
)

daemonCommand
  .command('start')
  .description('Register the daemon with the OS service manager and start it')
  .action(() => {
    const exitCode = handleDaemonStart({}, createClackUi())
    if (exitCode !== 0) process.exitCode = exitCode
  })

daemonCommand
  .command('stop')
  .description('Stop the daemon and unregister it from the OS service manager')
  .action(() => {
    const exitCode = handleDaemonStop({}, createClackUi())
    if (exitCode !== 0) process.exitCode = exitCode
  })

daemonCommand
  .command('status')
  .description('Show daemon health, subscriptions, and log location')
  .action(() => {
    const exitCode = handleDaemonStatus({}, createClackUi())
    if (exitCode !== 0) process.exitCode = exitCode
  })

daemonCommand
  .command('logs')
  .description('Print the daemon log tail')
  .option('-n, --lines <count>', 'Number of lines to print', '100')
  .action((opts: { lines: string }) => {
    const lines = Number.parseInt(opts.lines, 10)
    const exitCode = handleDaemonLogs(Number.isFinite(lines) && lines > 0 ? lines : 100)
    if (exitCode !== 0) process.exitCode = exitCode
  })

daemonCommand
  .command('run')
  .description('Run the daemon loop in the foreground (used by the service manager)')
  .action(() => {
    const exitCode = runDaemonLoop(createClackUi())
    if (exitCode !== 0) process.exitCode = exitCode
  })

function pickCredentialOptions(dependencies: HubCredentialOptions): HubCredentialOptions {
  return {
    ...(dependencies.homeDir === undefined ? {} : { homeDir: dependencies.homeDir }),
    ...(dependencies.env === undefined ? {} : { env: dependencies.env }),
  }
}

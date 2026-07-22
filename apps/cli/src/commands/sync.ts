import { getDB, Syncer, SpoolWatcher, type SyncEventCallback } from '@spool-lab/core'
import { Command } from 'commander'

import { createClackUi, type CliUi } from '../ui.js'

/** Refresh every supported provider into the local index. The bare `spool`
 * entry point reuses this before choosing the current Session, so sharing does
 * not depend on a separate, easy-to-forget `spool sync` step. */
export function syncLocalSessions(
  ui: CliUi,
  dependencies: {
    createSyncer?: (onProgress: SyncEventCallback) => Syncer
  } = {},
): Syncer | null {
  const status = ui.spinner()
  const onProgress: SyncEventCallback = (event) => {
    if (event.phase === 'scanning') {
      status.message(`Scanning ${event.total} session files`)
    } else if (event.phase === 'syncing') {
      status.message(`Indexing ${event.count}/${event.total} sessions`)
    }
  }

  status.start('Scanning local Agent sessions')
  try {
    const syncer = dependencies.createSyncer?.(onProgress) ?? new Syncer(getDB(), onProgress)
    const result = syncer.syncAll()
    status.stop(
      `Indexed ${result.added} new and ${result.updated} updated sessions` +
        (result.errors > 0 ? ` (${result.errors} errors)` : ''),
    )
    return syncer
  } catch (cause) {
    status.error('Session sync failed')
    ui.error(cause instanceof Error ? cause.message : String(cause))
    return null
  }
}

export const syncCommand = new Command('sync')
  .description('Sync AI sessions to the local index')
  .option('--watch', 'Stay running and watch for new sessions')
  .action((opts: { watch?: boolean }) => {
    const ui = createClackUi()
    ui.intro('Sync sessions')
    const syncer = syncLocalSessions(ui)
    if (syncer === null) {
      process.exitCode = 1
      return
    }

    if (!opts.watch) {
      ui.outro('Local index is up to date.')
      return
    }

    ui.info('Watching for new sessions. Press Ctrl+C to stop.')
    const watcher = new SpoolWatcher(syncer)
    watcher.on('new-sessions', (_event, data) => {
      ui.success(`${data.count} new session${data.count === 1 ? '' : 's'} indexed`)
    })
    watcher.on('error', (_event, data) => {
      ui.error(
        `Watcher error: ${data.error}${data.root === undefined ? '' : ` (root=${data.root})`}`,
      )
    })
    watcher.start()

    process.once('SIGINT', () => {
      watcher.stop()
      ui.outro('Stopped watching.')
      process.exitCode = 0
    })
  })

import { getDB, Syncer, type SyncEventCallback } from '@spool-lab/core'

import { reportAutoPublish, runAutoPublish, type AutoPublishResult } from '../hub/auto-publish.js'
import type { CliUi } from '../ui.js'

// Indexing is no longer a user-facing command: bare `spool` refreshes the
// index before sharing, and `spool daemon` keeps it continuously fresh. The
// routines live on here for both callers.

/** Refresh every supported provider into the local index. */
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

/** Auto-publish subscribed directories after an index pass. Serialized so
 * overlapping watcher flushes coalesce into one trailing pass instead of
 * racing the hub with the same sessions. */
export function createAutoPublisher(
  ui: CliUi,
  dependencies: {
    run?: (ui: CliUi) => Promise<AutoPublishResult | null>
  } = {},
): () => Promise<void> {
  const run = dependencies.run ?? ((forUi: CliUi) => runAutoPublish(forUi))
  let active: Promise<void> | null = null
  let rerun = false

  const pass = async (): Promise<void> => {
    try {
      reportAutoPublish(ui, await run(ui))
    } catch (cause) {
      ui.warn(`Auto-publish failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  return async () => {
    if (active) {
      rerun = true
      return active
    }
    active = (async () => {
      do {
        rerun = false
        await pass()
      } while (rerun)
    })().finally(() => {
      active = null
    })
    return active
  }
}

// Security Scan IPC handlers + channel constants.
//
// Translation boundary: Effect-typed worker calls in here become
// Promise-shaped Electron channels for renderer consumption. No
// Effect types leak past this file, matching the rest of Spool's
// IPC.

import { ipcMain, type BrowserWindow } from 'electron'
import { Effect, Fiber, Stream } from 'effect'
import {
  listFindings,
  listFindingsPage,
  listSessionsWithFindings,
  listSessionsWithFindingsPage,
  countSessionsWithFindings,
  riskByCategory,
  getFindingValue,
  getFindingValues,
  dismissFinding,
  undismissFinding,
  purgeFinding,
  purgeFindings,
  listAllowlistEntries,
  removeAllowlistSession,
  removeAllowlistGlobal,
  listBackups,
  deleteBackups,
  type FindingFilter,
  type SessionFindingFilter,
  type ScanWorker,
  type PurgeResult,
  type BackupFileInfo,
  type DeleteBackupsResult,
} from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'
import type Database from 'better-sqlite3'
import {
  loadSecurityPreferences,
  saveSecurityPreferences,
  type SecurityPreferences,
} from '../securityPreferences.js'

/** Channel name table. Shared via type only with the renderer adapter
 *  (no runtime import — preload uses the strings literally). */
export const SECURITY_IPC_CHANNELS = {
  // queries
  LIST_FINDINGS:               'security:list-findings',
  LIST_FINDINGS_PAGE:          'security:list-findings-page',
  LIST_SESSIONS_WITH_FINDINGS: 'security:list-sessions-with-findings',
  LIST_SESSIONS_WITH_FINDINGS_PAGE: 'security:list-sessions-with-findings-page',
  COUNT_SESSIONS_WITH_FINDINGS: 'security:count-sessions-with-findings',
  RISK_BY_CATEGORY:            'security:risk-by-category',
  GET_FINDING_VALUE:           'security:get-finding-value',
  GET_FINDING_VALUES:          'security:get-finding-values',
  GET_SCAN_STATUS:             'security:get-scan-status',

  // mutations
  DISMISS_FINDING:             'security:dismiss-finding',
  UNDISMISS_FINDING:           'security:undismiss-finding',
  PURGE_FINDING:               'security:purge-finding',
  PURGE_FINDINGS:              'security:purge-findings',
  RESCAN_ALL:                  'security:rescan-all',
  RESCAN_SESSION:              'security:rescan-session',

  // preferences
  GET_PREFS:                   'security:get-prefs',
  SET_PREFS:                   'security:set-prefs',

  // allowlist management
  LIST_ALLOWLIST_ENTRIES:      'security:list-allowlist-entries',
  REMOVE_ALLOWLIST_ENTRY:      'security:remove-allowlist-entry',

  // maintenance
  LIST_BACKUPS:                'security:list-backups',
  DELETE_BACKUPS:              'security:delete-backups',

  // events (push: main → renderer via webContents.send)
  EVT_FINDINGS_CHANGED:        'security:evt-findings-changed',
  EVT_SCAN_STATUS:             'security:evt-scan-status',
  EVT_PREFS_CHANGED:           'security:evt-prefs-changed',
} as const

export interface SecurityIpcDeps {
  db: Database.Database
  worker: ScanWorker
  /** Mount with `ManagedRuntime.make` so the IPC layer can run Effects
   *  without each call paying ManagedRuntime construction cost. */
  runPromise: <A, E>(eff: Effect.Effect<A, E>) => Promise<A>
  /** Subscribe to per-window pushes; called once per main window. */
  getMainWindow: () => BrowserWindow | null
}

/** Register every Security Scan ipcMain.handle and start a background
 *  fiber that forwards worker change events to the main window. The
 *  returned disposer interrupts the forwarding fiber. */
export function registerSecurityIpc(deps: SecurityIpcDeps): () => void {
  const { db, worker, runPromise, getMainWindow } = deps

  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_FINDINGS, (_e, filter: FindingFilter) =>
    listFindings(db, filter),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_FINDINGS_PAGE, (_e, filter: FindingFilter) =>
    listFindingsPage(db, filter),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_SESSIONS_WITH_FINDINGS, (_e, filter: SessionFindingFilter) =>
    listSessionsWithFindings(db, filter),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_SESSIONS_WITH_FINDINGS_PAGE, (_e, filter: SessionFindingFilter) =>
    listSessionsWithFindingsPage(db, filter),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.COUNT_SESSIONS_WITH_FINDINGS, (_e, filter: SessionFindingFilter) =>
    countSessionsWithFindings(db, filter),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.RISK_BY_CATEGORY, () =>
    riskByCategory(db),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.GET_FINDING_VALUE, (_e, findingId: number) =>
    getFindingValue(db, findingId),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.GET_FINDING_VALUES, (_e, ids: number[]) =>
    getFindingValues(db, ids),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.GET_SCAN_STATUS, () =>
    runPromise(worker.getStatus),
  )

  ipcMain.handle(
    SECURITY_IPC_CHANNELS.DISMISS_FINDING,
    (_e, args: { findingId: number; scope: 'session' | 'global' }) => {
      dismissFinding(db, args.findingId, args.scope)
      return { ok: true }
    },
  )
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.UNDISMISS_FINDING,
    (_e, args: { findingId: number }) => {
      undismissFinding(db, args.findingId)
      return { ok: true }
    },
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.PURGE_FINDING, async (_e, findingId: number) => {
    const publish = (change: Parameters<NonNullable<typeof getMainWindow extends () => infer R ? R : never>['webContents']['send']>[1]) =>
      Effect.sync(() => {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
      })
    const result = await runPromise(purgeFinding(findingId, { db, publish: publish as never })) as PurgeResult
    return result
  })
  ipcMain.handle(SECURITY_IPC_CHANNELS.PURGE_FINDINGS, async (_e, findingIds: number[]) => {
    const publish = (change: unknown) =>
      Effect.sync(() => {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
      })
    const results = await runPromise(purgeFindings(findingIds, { db, publish: publish as never })) as PurgeResult[]
    return results
  })
  ipcMain.handle(SECURITY_IPC_CHANNELS.RESCAN_ALL, () =>
    runPromise(worker.rescanAll()).then((count) => ({ count })),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.RESCAN_SESSION, (_e, sessionId: number) =>
    runPromise(worker.enqueue(sessionId)).then(() => ({ ok: true })),
  )

  ipcMain.handle(SECURITY_IPC_CHANNELS.GET_PREFS, () => loadSecurityPreferences())
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.SET_PREFS,
    async (_e, next: Partial<SecurityPreferences>) => {
      const prev = loadSecurityPreferences()
      const saved = saveSecurityPreferences(next)
      // When kindAllowlist changes, the new value is folded into
      // `currentProfileString()` via the worker's lazy `() => ...`
      // callback. We can simply kick `worker.backfill()`, which
      // re-resolves the profile, lists sessions whose `scan_profile`
      // no longer matches the new hash, and enqueues them. No need
      // to NULL out every scan_profile any more — the hash drift
      // handles it cleanly without an extra UPDATE pass over the
      // sessions table.
      const prevKinds = new Set(prev.kindAllowlist)
      const nextKinds = new Set(saved.kindAllowlist)
      const changed = prevKinds.size !== nextKinds.size ||
        [...prevKinds].some(k => !nextKinds.has(k)) ||
        [...nextKinds].some(k => !prevKinds.has(k))
      if (changed) {
        await runPromise(worker.backfill())
      }
      getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED, saved)
      return saved
    },
  )

  ipcMain.handle(
    SECURITY_IPC_CHANNELS.LIST_BACKUPS,
    (): BackupFileInfo[] => listBackups(db),
  )
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.DELETE_BACKUPS,
    (_e, args: { names: string[] }): DeleteBackupsResult => deleteBackups(db, args.names),
  )

  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_ALLOWLIST_ENTRIES, () => listAllowlistEntries(db))
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.REMOVE_ALLOWLIST_ENTRY,
    (_e, args: { scope: 'session' | 'global'; kind: SensitiveKind; valueHash: string; sessionUuid?: string }) => {
      if (args.scope === 'global') {
        removeAllowlistGlobal(db, args.kind, args.valueHash)
      } else if (args.sessionUuid) {
        const row = db.prepare('SELECT id FROM sessions WHERE session_uuid = ?')
          .get(args.sessionUuid) as { id: number } | undefined
        if (row) removeAllowlistSession(db, row.id, args.kind, args.valueHash)
      }
      // Removing an allowlist entry doesn't reactivate the already-
      // dismissed finding rows — that's intentional: a user who said
      // "ignore" once shouldn't have it bounce back on every rescan.
      // The Security page lists `state='dismissed'` separately.
      return { ok: true }
    },
  )

  // Forward worker change events to the renderer.
  //
  // Bug-fix note: this fiber MUST be `forkDaemon`, not `fork`. The
  // previous `Effect.runPromise(Effect.fork(stream))` attached the
  // forwarder to the runtime scope created by `runPromise`, which
  // closes the instant runPromise resolves with the fiber handle.
  // The forwarder fiber then got interrupted before seeing its
  // first event, and renderers never received `session-rescanned`
  // / `state-changed` events even though the worker was publishing
  // them. This is what surfaced as "muting a kind in Settings does
  // not refresh the Security page" — the DB state was correct but
  // the page had no signal to re-fetch.
  //
  // `forkDaemon` detaches the fiber from the parent scope; it lives
  // until explicitly interrupted by the returned disposer below.
  let forwarderFiber: Fiber.RuntimeFiber<void, never> | null = null
  let statusForwarderFiber: Fiber.RuntimeFiber<void, never> | null = null
  // Stream consumers wrapped in `Effect.catchAllDefect` — webContents
  // .send synchronously throws on a destroyed window (e.g. user closed
  // the main window while a scan was mid-burst). Without this the
  // daemon fiber dies on the first throw and every subsequent
  // change / status event is silently lost. Logging + swallowing
  // keeps the fiber alive across window lifecycle events; the next
  // surviving send will reach a new window if one opens.
  function safeSend(channel: string, payload: unknown): Effect.Effect<void> {
    return Effect.sync(() => {
      try {
        // webContents.send throws if the BrowserWindow has been
        // destroyed — caught here so a closed window doesn't take
        // the daemon fiber with it.
        getMainWindow()?.webContents.send(channel, payload)
      } catch (err) {
        console.error('[security] forwarder send failed:', err)
      }
    })
  }

  Effect.runPromise(
    Effect.gen(function* () {
      forwarderFiber = yield* Effect.forkDaemon(
        Stream.runForEach(worker.changes, (change) =>
          safeSend(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change),
        ),
      )
      // Parallel forwarder for ScanStatus snapshots — every queue /
      // scan / backfill mutation in the worker publishes one, the
      // renderer's onScanStatus subscription replaces what used to be
      // a 500 ms pull loop.
      statusForwarderFiber = yield* Effect.forkDaemon(
        Stream.runForEach(worker.statusChanges, (status) =>
          safeSend(SECURITY_IPC_CHANNELS.EVT_SCAN_STATUS, status),
        ),
      )
    }),
  ).catch(() => { /* fork rejected; ignore (cleanup path) */ })

  return () => {
    if (forwarderFiber) {
      Effect.runFork(Fiber.interrupt(forwarderFiber))
    }
    if (statusForwarderFiber) {
      Effect.runFork(Fiber.interrupt(statusForwarderFiber))
    }
    for (const ch of Object.values(SECURITY_IPC_CHANNELS)) {
      ipcMain.removeHandler(ch)
    }
  }
}

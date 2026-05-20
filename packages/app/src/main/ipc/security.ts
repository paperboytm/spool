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
  listSessionsWithFindings,
  riskByCategory,
  getFindingValue,
  getFindingValues,
  dismissFinding,
  undismissFinding,
  type FindingFilter,
  type SessionFindingFilter,
  type ScanWorker,
} from '@spool-lab/core'
import type Database from 'better-sqlite3'

/** Channel name table. Shared via type only with the renderer adapter
 *  (no runtime import — preload uses the strings literally). */
export const SECURITY_IPC_CHANNELS = {
  // queries
  LIST_FINDINGS:               'security:list-findings',
  LIST_SESSIONS_WITH_FINDINGS: 'security:list-sessions-with-findings',
  RISK_BY_CATEGORY:            'security:risk-by-category',
  GET_FINDING_VALUE:           'security:get-finding-value',
  GET_FINDING_VALUES:          'security:get-finding-values',
  GET_SCAN_STATUS:             'security:get-scan-status',

  // mutations
  DISMISS_FINDING:             'security:dismiss-finding',
  UNDISMISS_FINDING:           'security:undismiss-finding',
  RESCAN_ALL:                  'security:rescan-all',
  RESCAN_SESSION:              'security:rescan-session',

  // events (push: main → renderer via webContents.send)
  EVT_FINDINGS_CHANGED:        'security:evt-findings-changed',
  EVT_SCAN_STATUS:             'security:evt-scan-status',
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
  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_SESSIONS_WITH_FINDINGS, (_e, filter: SessionFindingFilter) =>
    listSessionsWithFindings(db, filter),
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
  ipcMain.handle(SECURITY_IPC_CHANNELS.RESCAN_ALL, () =>
    runPromise(worker.rescanAll()).then((count) => ({ count })),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.RESCAN_SESSION, (_e, sessionId: number) =>
    runPromise(worker.enqueue(sessionId)).then(() => ({ ok: true })),
  )

  // Forward worker change events to the renderer. The subscriber runs
  // for the worker's lifetime; we interrupt it via the returned
  // disposer when the IPC layer tears down.
  let forwarderFiber: Fiber.RuntimeFiber<void, never> | null = null
  Effect.runPromise(
    Effect.fork(
      Stream.runForEach(worker.changes, (change) =>
        Effect.sync(() => {
          getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
        }),
      ),
    ),
  )
    .then((f) => { forwarderFiber = f as Fiber.RuntimeFiber<void, never> })
    .catch(() => { /* fiber rejected; ignore (cleanup path) */ })

  return () => {
    if (forwarderFiber) {
      Effect.runFork(Fiber.interrupt(forwarderFiber))
    }
    for (const ch of Object.values(SECURITY_IPC_CHANNELS)) {
      ipcMain.removeHandler(ch)
    }
  }
}

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
  occurrencesByValueHash,
  riskByCategory,
  lastScanCompletedAt,
  getFindingValue,
  getFindingValues,
  dismissFinding,
  dismissFindings,
  undismissFinding,
  purgeFinding,
  purgeFindings,
  purgeEverywhere,
  listAllowlistEntries,
  countAllowlistEntries,
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
import type { PfCoordinator } from '../security/pf-coordinator.js'
import type { PfRuntime } from '../security/pf-runtime.js'
import type { MutationWorkerProxy } from '../mutation-worker-proxy.js'

/** Channel name table. Shared via type only with the renderer adapter
 *  (no runtime import — preload uses the strings literally). */
export const SECURITY_IPC_CHANNELS = {
  // queries
  LIST_FINDINGS:               'security:list-findings',
  LIST_FINDINGS_PAGE:          'security:list-findings-page',
  LIST_SESSIONS_WITH_FINDINGS: 'security:list-sessions-with-findings',
  LIST_SESSIONS_WITH_FINDINGS_PAGE: 'security:list-sessions-with-findings-page',
  COUNT_SESSIONS_WITH_FINDINGS: 'security:count-sessions-with-findings',
  OCCURRENCES_BY_VALUE_HASH:   'security:occurrences-by-value-hash',
  RISK_BY_CATEGORY:            'security:risk-by-category',
  LAST_SCAN_COMPLETED_AT:      'security:last-scan-completed-at',
  GET_FINDING_VALUE:           'security:get-finding-value',
  GET_FINDING_VALUES:          'security:get-finding-values',
  GET_SCAN_STATUS:             'security:get-scan-status',

  // mutations
  DISMISS_FINDING:             'security:dismiss-finding',
  DISMISS_FINDINGS:            'security:dismiss-findings',
  UNDISMISS_FINDING:           'security:undismiss-finding',
  PURGE_FINDING:               'security:purge-finding',
  PURGE_FINDINGS:              'security:purge-findings',
  PURGE_EVERYWHERE:            'security:purge-everywhere',
  RESCAN_ALL:                  'security:rescan-all',
  RESCAN_SESSION:              'security:rescan-session',

  // preferences
  GET_PREFS:                   'security:get-prefs',
  SET_PREFS:                   'security:set-prefs',

  // allowlist management
  LIST_ALLOWLIST_ENTRIES:      'security:list-allowlist-entries',
  COUNT_ALLOWLIST_ENTRIES:     'security:count-allowlist-entries',
  REMOVE_ALLOWLIST_ENTRY:      'security:remove-allowlist-entry',

  // maintenance
  LIST_BACKUPS:                'security:list-backups',
  DELETE_BACKUPS:              'security:delete-backups',

  // Privacy Filter ML download lifecycle
  PF_GET_STATE:                'security:pf-get-state',
  PF_DOWNLOAD_START:           'security:pf-download-start',
  PF_DOWNLOAD_CANCEL:          'security:pf-download-cancel',
  /** Returns the inference runtime info — null when the ModelHost
   *  isn't running. Polled by PfDownloadCard for the runtime badge. */
  PF_GET_RUNTIME_INFO:         'security:pf-get-runtime-info',

  // readiness — eagerly registered so the renderer can wait for the
  // scan worker without bumping into "No handler registered" errors
  // when Settings → Security opens during boot, and so a worker-boot
  // failure surfaces as a "Scanner unavailable" banner instead of a
  // dead UI.
  GET_READINESS:               'security:get-readiness',

  // events (push: main → renderer via webContents.send)
  EVT_FINDINGS_CHANGED:        'security:evt-findings-changed',
  EVT_SCAN_STATUS:             'security:evt-scan-status',
  EVT_PREFS_CHANGED:           'security:evt-prefs-changed',
  EVT_PF_STATE:                'security:evt-pf-state',
  EVT_READINESS_CHANGED:       'security:evt-readiness-changed',
} as const

export type SecurityReadiness =
  | { ready: true }
  | { ready: false; reason: 'booting' | 'scanner-unavailable' }

/** Register the readiness handler + return a setter the boot sequence
 *  calls when the scan worker either comes up (`{ ready: true }`) or
 *  fails to spawn (`{ ready: false, reason: 'scanner-unavailable' }`).
 *
 *  Registered eagerly (before `bootScanWorker()` resolves) so the
 *  renderer can ALWAYS query readiness — opening Settings → Security
 *  the millisecond the window appears no longer races the worker
 *  boot, which used to produce "No handler registered for
 *  security:list-backups" errors. */
export function registerSecurityReadinessIpc(
  getMainWindow: () => BrowserWindow | null,
): {
  setReadiness: (next: SecurityReadiness) => void
  dispose: () => void
} {
  let current: SecurityReadiness = { ready: false, reason: 'booting' }
  ipcMain.handle(SECURITY_IPC_CHANNELS.GET_READINESS, () => current)
  return {
    setReadiness: (next) => {
      // Same-value transitions are a no-op so the renderer doesn't
      // re-render its skeleton on every boot retry.
      if (next.ready === current.ready &&
        (next.ready || next.reason === (current as { reason: string }).reason)) {
        return
      }
      current = next
      try {
        getMainWindow()?.webContents.send(
          SECURITY_IPC_CHANNELS.EVT_READINESS_CHANGED,
          next,
        )
      } catch (err) {
        console.error('[security] readiness broadcast failed:', err)
      }
    },
    dispose: () => {
      ipcMain.removeHandler(SECURITY_IPC_CHANNELS.GET_READINESS)
    },
  }
}

export interface SecurityIpcDeps {
  db: Database.Database
  worker: ScanWorker
  /** Mount with `ManagedRuntime.make` so the IPC layer can run Effects
   *  without each call paying ManagedRuntime construction cost. */
  runPromise: <A, E>(eff: Effect.Effect<A, E>) => Promise<A>
  /** Subscribe to per-window pushes; called once per main window. */
  getMainWindow: () => BrowserWindow | null
  /** Privacy Filter download orchestrator. Optional in 5b — null means
   *  the PF channels return a default not-installed snapshot. PR 5c
   *  swaps in a real coordinator when the toggle flips on. */
  pfCoordinator?: PfCoordinator | null
  /** Notified when the user flips `pfEnabled` in Settings. Main wires
   *  this to pfRuntime.start() / stop() so the inference window only
   *  exists when the user actually wants ML detection on. */
  onPfEnabledChanged?: (enabled: boolean) => void
  /** The live ModelHost lifecycle. Exposed via PF_GET_RUNTIME_INFO
   *  so the renderer can display "WebGPU · Apple M2 Pro" once the
   *  hidden window has finished its handshake. */
  pfRuntime?: PfRuntime | null
}

export interface SecurityIpcHandle {
  /** Interrupts all forwarder daemons + removes every ipcMain.handle
   *  registration. Idempotent — fine to call after a failed attach. */
  dispose: () => void
  /** Late-bind a mutation worker so the IPC handlers start delegating
   *  purge / dismiss / undismiss to it, AND fork the change-event
   *  forwarder onto the worker's `changes` stream. Mutation worker
   *  boot happens in the background after `registerSecurityIpc`
   *  returns so the IPC layer is live the moment the scan worker is
   *  ready — without this split, the e2e harness opens the first
   *  window before mutation-worker boot completes and `security:
   *  get-scan-status` rejects with "No handler registered" before
   *  the worker proxies the call.
   *
   *  Calling twice or with the same proxy is a no-op-ish: the prior
   *  forwarder is left running (no harm — the previous PubSub
   *  becomes unreachable and GCs once the proxy reference drops).
   *  Real-world flow boots one proxy, attaches it, and replaces only
   *  on teardown / re-boot. */
  attachMutationWorker: (proxy: MutationWorkerProxy) => void
}

/** Register every Security Scan ipcMain.handle and start a background
 *  fiber that forwards scan-worker change + status events to the main
 *  window. Mutation-worker boot is intentionally deferred — call
 *  `attachMutationWorker(proxy)` on the returned handle once the
 *  worker is ready so the IPC layer becomes live before that boot
 *  completes. */
export function registerSecurityIpc(deps: SecurityIpcDeps): SecurityIpcHandle {
  const { db, worker, runPromise, getMainWindow, pfCoordinator, pfRuntime: hostRuntime, onPfEnabledChanged } = deps
  // Closure-local ref read by every mutation handler at call time —
  // lets `attachMutationWorker` swap the worker in after IPC has
  // already started taking calls. Until it's set the handlers fall
  // back to in-process SQL on the main thread.
  let currentMutationWorker: MutationWorkerProxy | null = null

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
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.OCCURRENCES_BY_VALUE_HASH,
    (_e, args: { kind: SensitiveKind; valueHash: string }) =>
      occurrencesByValueHash(db, args.kind, args.valueHash),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.RISK_BY_CATEGORY, () =>
    riskByCategory(db),
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.LAST_SCAN_COMPLETED_AT, () =>
    lastScanCompletedAt(db),
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

  // All write paths route through `currentMutationWorker` when present so
  // the main event loop stays free during multi-second bulk
  // operations on a large archive. The fallback to in-process is
  // kept for the rare worker-boot-failure case (and for the IPC
  // unit-tests that don't spin up a real worker) — the existing core
  // helpers run synchronously on `db` exactly as before.
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.DISMISS_FINDING,
    async (_e, args: { findingId: number; scope: 'session' | 'global' }) => {
      if (currentMutationWorker) {
        // Per-event publish lands via the proxy's `changes` stream
        // (subscribed below in the forwarder fiber), so no need to
        // webContents.send on success here.
        await currentMutationWorker.dismissFinding(args.findingId, args.scope)
        return { ok: true }
      }
      const sessionId = dismissFinding(db, args.findingId, args.scope, true)
      if (sessionId != null) {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, {
          type: 'state-changed', sessionId, findingId: args.findingId, state: 'dismissed',
        })
      }
      return { ok: true }
    },
  )
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.DISMISS_FINDINGS,
    async (_e, args: { findingIds: number[]; scope: 'session' | 'global' }) => {
      if (currentMutationWorker) {
        await currentMutationWorker.dismissFindings(args.findingIds, args.scope)
        return { ok: true }
      }
      const sessionIds = dismissFindings(db, args.findingIds, args.scope)
      for (const sessionId of sessionIds) {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, {
          type: 'state-changed', sessionId, state: 'dismissed',
        })
      }
      return { ok: true }
    },
  )
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.UNDISMISS_FINDING,
    async (_e, args: { findingId: number }) => {
      if (currentMutationWorker) {
        await currentMutationWorker.undismissFinding(args.findingId)
        return { ok: true }
      }
      const sessionId = undismissFinding(db, args.findingId)
      if (sessionId != null) {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, {
          type: 'state-changed', sessionId, findingId: args.findingId, state: 'active',
        })
      }
      return { ok: true }
    },
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.PURGE_FINDING, async (_e, findingId: number) => {
    if (currentMutationWorker) return currentMutationWorker.purgeFinding(findingId)
    const publish = (change: Parameters<NonNullable<typeof getMainWindow extends () => infer R ? R : never>['webContents']['send']>[1]) =>
      Effect.sync(() => {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
      })
    const result = await runPromise(purgeFinding(findingId, { db, publish: publish as never })) as PurgeResult
    return result
  })
  ipcMain.handle(SECURITY_IPC_CHANNELS.PURGE_FINDINGS, async (_e, findingIds: number[]) => {
    if (currentMutationWorker) return currentMutationWorker.purgeFindings(findingIds)
    const publish = (change: unknown) =>
      Effect.sync(() => {
        getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
      })
    const results = await runPromise(purgeFindings(findingIds, { db, publish: publish as never })) as PurgeResult[]
    return results
  })
  ipcMain.handle(
    SECURITY_IPC_CHANNELS.PURGE_EVERYWHERE,
    async (_e, args: { kind: SensitiveKind; valueHash: string }) => {
      if (currentMutationWorker) {
        const out = await currentMutationWorker.purgeEverywhere(args.kind, args.valueHash)
        return { count: out.results.length, sessionIds: out.sessionIds }
      }
      const publish = (change: unknown) =>
        Effect.sync(() => {
          getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change)
        })
      const out = await runPromise(
        purgeEverywhere(args.kind, args.valueHash, { db, publish: publish as never }),
      ) as { results: PurgeResult[]; sessionIds: number[] }
      return { count: out.results.length, sessionIds: out.sessionIds }
    },
  )
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
        // User clicked a kind-mute toggle — propagate the
        // user-initiated marker so the renderer's busy→idle edge
        // surfaces a "Scan complete" result banner instead of
        // silently letting the progress banner vanish.
        await runPromise(worker.backfill({ userInitiated: true }))
      }
      if (prev.pfEnabled !== saved.pfEnabled) {
        try { onPfEnabledChanged?.(saved.pfEnabled) }
        catch (err) { console.error('[security] onPfEnabledChanged threw:', err) }
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

  // Privacy Filter ML. When pfCoordinator is null (5b production), the
  // channels return a static not-installed snapshot so the renderer
  // renders its Download affordance instead of crashing.
  ipcMain.handle(SECURITY_IPC_CHANNELS.PF_GET_STATE, () =>
    pfCoordinator?.getState() ?? { phase: 'not-installed', bytesDownloaded: 0, bytesTotal: 0 },
  )
  ipcMain.handle(SECURITY_IPC_CHANNELS.PF_DOWNLOAD_START, async () => {
    if (!pfCoordinator) return { ok: false, reason: 'unavailable' as const }
    await pfCoordinator.startDownload()
    return { ok: true as const }
  })
  ipcMain.handle(SECURITY_IPC_CHANNELS.PF_DOWNLOAD_CANCEL, () => {
    pfCoordinator?.cancelDownload()
    return { ok: true as const }
  })
  ipcMain.handle(SECURITY_IPC_CHANNELS.PF_GET_RUNTIME_INFO, async () => {
    if (!hostRuntime?.isActive()) return null
    return hostRuntime.getState()
  })
  const unsubscribePf = pfCoordinator?.subscribe((s) => {
    getMainWindow()?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PF_STATE, s)
  })

  ipcMain.handle(SECURITY_IPC_CHANNELS.LIST_ALLOWLIST_ENTRIES, () => listAllowlistEntries(db))
  ipcMain.handle(SECURITY_IPC_CHANNELS.COUNT_ALLOWLIST_ENTRIES, () => countAllowlistEntries(db))
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
  let mutationForwarderFiber: Fiber.RuntimeFiber<void, never> | null = null
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

  // Mutation-worker change forwarder is forked when `attachMutationWorker`
  // fires, not at registration time, so the IPC layer is live even
  // before the worker has finished booting. Stored here so `dispose`
  // can interrupt it alongside the scan-worker forwarders.
  const dispose = (): void => {
    if (forwarderFiber) {
      Effect.runFork(Fiber.interrupt(forwarderFiber))
    }
    if (statusForwarderFiber) {
      Effect.runFork(Fiber.interrupt(statusForwarderFiber))
    }
    if (mutationForwarderFiber) {
      Effect.runFork(Fiber.interrupt(mutationForwarderFiber))
    }
    unsubscribePf?.()
    for (const ch of Object.values(SECURITY_IPC_CHANNELS)) {
      ipcMain.removeHandler(ch)
    }
  }

  const attachMutationWorker = (proxy: MutationWorkerProxy): void => {
    currentMutationWorker = proxy
    // Mutation worker has its own per-mutation FindingsChange stream;
    // forward it onto the SAME EVT_FINDINGS_CHANGED renderer channel
    // so consumers can't tell whether the publish came from a scan
    // or a purge / dismiss. Until this fork runs, the per-handler
    // fallback path sends its own EVT_FINDINGS_CHANGED for the same
    // mutations — events still flow, they just take the in-process
    // route.
    Effect.runPromise(
      Effect.gen(function* () {
        mutationForwarderFiber = yield* Effect.forkDaemon(
          Stream.runForEach(proxy.changes, (change) =>
            safeSend(SECURITY_IPC_CHANNELS.EVT_FINDINGS_CHANGED, change),
          ),
        )
      }),
    ).catch(() => { /* fork rejected; ignore */ })
  }

  return { dispose, attachMutationWorker }
}

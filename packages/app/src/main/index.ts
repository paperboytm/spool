import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, nativeImage, net, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

// Install global error handlers as the very first thing in the file. Node 22
// defaults to --unhandled-rejections=strict, which means a single unhandled
// rejection — anywhere in this process or any worker_threads child — aborts
// the app with SIGTRAP (EXC_BREAKPOINT). Users see the macOS crash dialog
// with no actionable information. With these handlers attached, the process
// keeps running and we log enough context to diagnose later.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason)
  if (reason instanceof Error && reason.stack) console.error(reason.stack)
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  try {
    // Don't exit — UI surfaces that already loaded should keep working.
    // The dialog is best-effort; if Electron itself isn't ready yet this
    // throws, and we just log.
    dialog.showErrorBox(
      'Spool ran into an unexpected error',
      `${err instanceof Error ? err.message : String(err)}\n\n` +
        `Spool will keep running, but if you see this repeatedly please restart the app.`,
    )
  } catch { /* dialog unavailable — log already happened */ }
})

import {
  getDB, Syncer, SpoolWatcher,
  searchFragments, searchSessionPreview, listRecentSessionsPage, getSessionWithMessages, getStatus,
  pinSession, unpinSession, getPinnedUuids, listPinnedSessions,
  listProjectGroups, listSessionsByIdentity, listPinnedSessionsByIdentity, listProjectDirectoryCounts,
  listShareDrafts, getShareDraft, upsertShareDraft, deleteShareDraft, countDraftsBySession,
  invalidateSessionScanProfile,
  makeObservabilityRuntime,
  SPOOL_DIR,
} from '@spool-lab/core'
import { spawnScanWorker, type ScanWorkerProxy } from './scan-worker-proxy.js'
import { Effect } from 'effect'
import { registerSecurityIpc, registerSecurityReadinessIpc, SECURITY_IPC_CHANNELS, type SecurityReadiness } from './ipc/security.js'
import { loadSecurityPreferences, saveSecurityPreferences } from './securityPreferences.js'
import { makePfRuntime, pfModelInstalled } from './security/pf-runtime.js'
import { registerPfModelProtocol, registerPfModelScheme } from './security/pf-model-protocol.js'
import { makePfCoordinator } from './security/pf-coordinator.js'
import { pfModelDir } from './security/model-paths.js'
import type {
  FragmentResult, SessionSource, ListSessionsByIdentityOptions, SessionsCursor,
  ShareDraftRow, UpsertShareDraftInput,
} from '@spool-lab/core'
import { setupTray } from './tray.js'
import { AcpManager } from './acp.js'
import { setupAutoUpdater, downloadUpdate, quitAndInstall } from './updater.js'
import { openTerminal } from './terminal.js'
import { getSessionResumeCommand } from '../shared/resumeCommand.js'
import { resolveResumeWorkingDirectory } from './sessionResume.js'
import { loadUIPreferences, saveThemeEditor, saveThemeSource, saveSidebarCollapsed } from './uiPreferences.js'
import { hydrateBinaryCache } from './binaryCache.js'
import { snapshotEventLoopLag, startEventLoopMonitor } from './eventLoopMonitor.js'
import type Database from 'better-sqlite3'
import type { SyncWorkerMessage } from './sync-worker.js'

// Privilege the `pf-model://` scheme before app.ready so the hidden
// inference renderer can fetch model files through it. Has to happen
// here (module top-level) because protocol.registerSchemesAsPrivileged
// is a no-op once Electron has finished initialising.
registerPfModelScheme()

// Start the main-process event-loop lag monitor before any other module
// has a chance to do work. Cheap (a C++ histogram in node:perf_hooks).
// Exposed only when SPOOL_E2E_TEST=1, via a global the e2e harness can
// reach with `electronApp.evaluate(...)` — no production IPC surface.
startEventLoopMonitor()
if (process.env['SPOOL_E2E_TEST'] === '1') {
  ;(globalThis as { __spoolEventLoopLag?: typeof snapshotEventLoopLag }).__spoolEventLoopLag = snapshotEventLoopLag
}

const isDevMode = Boolean(process.env['ELECTRON_RENDERER_URL'])
const isMac = process.platform === 'darwin'
const customUserDataDir = process.env['SPOOL_ELECTRON_USER_DATA_DIR']?.trim()
if (customUserDataDir) {
  app.setPath('userData', customUserDataDir)
}

const { run: runWithObservability } = makeObservabilityRuntime(
  isDevMode
    ? { serviceName: 'spool-app-main', serviceVersion: app.getVersion(), env: 'dev' }
    : { serviceName: 'spool-app-main', serviceVersion: app.getVersion(), env: 'prod', logsDir: join(SPOOL_DIR, 'logs') },
)
// macOS menu bar shows the first menu's label as the app name
app.setName(isDevMode ? 'Spool DEV' : 'Spool')

const uiPreferences = loadUIPreferences()
nativeTheme.themeSource = uiPreferences.themeSource
let focusExistingWindow = () => {}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

app.on('second-instance', () => {
  focusExistingWindow()
})

let mainWindow: BrowserWindow | null = null
let db: Database.Database
let syncer: Syncer
let watcher: SpoolWatcher
let acpManager: AcpManager
let isSyncActive = false
let scanWorker: ScanWorkerProxy | null = null
let disposeSecurityIpc: (() => void) | null = null
let setSecurityReadiness: ((next: SecurityReadiness) => void) | null = null
let disposeSecurityReadinessIpc: (() => void) | null = null
const pfRuntime = makePfRuntime({
  run: runWithObservability,
  // A post-handshake renderer crash leaves the ModelHost reporting
  // `ready` unless something flips it; the host now transitions to
  // `failed` on its own, but the scan worker only learns pf is offline
  // through this hook. Without it the worker keeps stamping `pf@...`
  // into scan_profile while every analyze round-trips to a dead window
  // and returns [] — a regex-only scan masquerading as ML coverage.
  onCrash: () => {
    console.error('[security] pf inference renderer crashed — taking scan worker offline')
    scanWorker?.notifyPfOffline()
  },
})
// Lazily resolved on first access — pfModelsRoot() reads app.getPath
// which throws before app.ready, but this module evaluates at boot.
let pfCoordinator: ReturnType<typeof makePfCoordinator> | null = null

type CachedSearchValue = FragmentResult[]

class SearchCache {
  private entries = new Map<string, { results: CachedSearchValue; expiresAt: number }>()

  get(key: string): CachedSearchValue | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.results
  }

  set(key: string, value: CachedSearchValue): void {
    if (value.length === 0) return
    this.entries.delete(key)
    this.entries.set(key, {
      results: value,
      expiresAt: Date.now() + 15000,
    })
    if (this.entries.size > 200) {
      const oldest = this.entries.keys().next().value
      if (oldest) this.entries.delete(oldest)
    }
  }

  clear(): void {
    this.entries.clear()
  }
}

const searchCache = new SearchCache()

/** Main-process mirror of the renderer's `securityFeatureEnabled()`.
 *
 *  The renderer reads `import.meta.env.DEV` and
 *  `import.meta.env.VITE_FEATURE_SECURITY` (Vite inlines both at
 *  build time). Electron's main process bundle can read the same
 *  values — `electron-vite build` substitutes them just like for
 *  the renderer.
 *
 *  Kept inline here (rather than imported from
 *  `../renderer/featureFlags`) because main code mustn't import
 *  React-side modules: those pull in the whole renderer dep graph.
 *
 *  When this returns `false`, the scan worker and IPC handlers
 *  stay un-booted on production user machines. The DB migrations
 *  still run unconditionally — schema must be forward-compatible
 *  so that flipping the flag on later doesn't require a second
 *  upgrade pass. */
function securityFeatureEnabled(): boolean {
  const env = (import.meta as any).env as { DEV?: boolean; VITE_FEATURE_SECURITY?: string } | undefined
  if (env?.DEV) return true
  return env?.VITE_FEATURE_SECURITY === '1'
}

async function bootScanWorker(): Promise<void> {
  try {
    // Engine lives in a worker thread so its synchronous SQL + regex
    // CPU work doesn't block the main-process event loop — keeping
    // window drag, foreground IPC, and renderer-driven queries
    // responsive even mid-backfill. WAL mode lets the main-process
    // read handle coexist with the worker's write handle.
    //
    // The pfBridge proxies the worker's pf-analyze-req messages
    // through pfRuntime.analyze → hidden inference window. When
    // pfRuntime isn't active, analyze() returns [] so the worker
    // gets an empty result quickly instead of blocking.
    scanWorker = await spawnScanWorker(join(__dirname, 'scan-worker-thread.js'), {
      analyze: (text) => pfRuntime.analyze(text) as Promise<Array<{
        class: string; value: string; start: number; end: number; score: number
      }>>,
    })
  } catch (err) {
    console.error('[security] scan worker failed to boot:', err)
    scanWorker = null
  }
}

async function shutdownScanWorker(): Promise<void> {
  if (disposeSecurityIpc) {
    try { disposeSecurityIpc() } catch { /* best effort */ }
    disposeSecurityIpc = null
  }
  if (disposeSecurityReadinessIpc) {
    try { disposeSecurityReadinessIpc() } catch { /* best effort */ }
    disposeSecurityReadinessIpc = null
    setSecurityReadiness = null
  }
  if (scanWorker) {
    try {
      await scanWorker.shutdown()
    } catch { /* best effort */ }
    scanWorker = null
  }
  try { await pfRuntime.stop() } catch { /* best effort */ }
}

/** Bring the Privacy Filter inference window up or down to match the
 *  user's pfEnabled preference. Refuses to start the runtime if the
 *  ONNX weights aren't installed yet — flipping the toggle on while
 *  the download hasn't finished would just spawn a window with
 *  nothing to load. Tells the scan worker about the transition so its
 *  pfProvider.available() agrees with reality and `scan_profile`
 *  drifts (triggering a backfill rescan via worker.backfill()).
 *
 *  Also clears pfActivationPending on the way out — the callout's
 *  "Activating Privacy Filter…" state hangs on that flag, so it
 *  needs to drop the moment the runtime + backfill have settled
 *  (success or fail). The ScanBanner then takes over visually. */
async function syncPfRuntime(pfEnabled: boolean): Promise<void> {
  await runWithObservability(
    Effect.gen(function* () {
      yield* Effect.annotateCurrentSpan('pf.enabled', pfEnabled)
      if (pfEnabled && pfModelInstalled()) {
        yield* Effect.promise(() => pfRuntime.start())
        // pfRuntime.start() resolves even when the handshake failed —
        // the hidden window might be up but transformers.js / ONNX
        // crashed during model load. Check the actual runtime state
        // before telling the scan worker pf is online: otherwise
        // currentProfile drifts to `regex@1,pf@1.5b-q4.r2`, every analyze
        // round-trips to a dead host that returns [], and the user
        // sees regex-only findings tagged with a profile string that
        // lies about what scanned them.
        const state = yield* Effect.promise(() => pfRuntime.getState())
        yield* Effect.annotateCurrentSpan('pf.runtime.status', state?.status ?? 'null')
        if (state?.runtime) yield* Effect.annotateCurrentSpan('pf.runtime.kind', state.runtime)
        if (state?.error) yield* Effect.annotateCurrentSpan('pf.runtime.error', state.error)
        if (state?.status === 'ready') {
          yield* Effect.sync(() => scanWorker?.notifyPfOnline())
          yield* Effect.annotateCurrentSpan('pf.notified', 'online')
        } else {
          yield* Effect.logError(
            `[security] pf runtime failed to reach ready (status=${state?.status ?? 'unknown'}, error=${state?.error ?? 'unknown'})`,
          )
          yield* Effect.sync(() => scanWorker?.notifyPfOffline())
          yield* Effect.annotateCurrentSpan('pf.notified', 'offline')
        }
      } else {
        yield* Effect.sync(() => scanWorker?.notifyPfOffline())
        yield* Effect.promise(() => pfRuntime.stop())
      }
      if (scanWorker) {
        // User flipped the PF toggle (or completed the callout's
        // "Activate" flow) — mark this backfill as user-initiated so
        // the renderer shows a result banner on busy→idle, instead
        // of treating it as background work.
        yield* scanWorker.backfill({ userInitiated: true })
      }
    }).pipe(
      // pfActivationPending clears on the way out (success OR fail) so
      // the callout's "Activating…" state stops hanging on a permanent
      // failure. ScanBanner takes over visually once backfill enqueues.
      Effect.ensuring(Effect.sync(() => {
        const cur = loadSecurityPreferences()
        if (cur.pfActivationPending) {
          const next = saveSecurityPreferences({ pfActivationPending: false })
          mainWindow?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED, next)
        }
      })),
      Effect.withSpan('pf.sync_runtime'),
    ),
  )
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    title: isDevMode ? 'Spool DEV' : 'Spool',
    width: 1080,
    height: 740,
    minWidth: 800,
    minHeight: 520,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141410' : '#FAFAF8',
    autoHideMenuBar: !isMac,
    // hiddenInset keeps the traffic lights but lets the renderer paint
    // up to y=0, so the app's top bar sits flush with the close/min/max
    // buttons instead of stacking under a separate OS-rendered title bar.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (!isMac) {
    win.setMenuBarVisibility(false)
  }

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    const isInternal =
      url === current ||
      url.startsWith('file://') ||
      (!!process.env['ELECTRON_RENDERER_URL'] && url.startsWith(process.env['ELECTRON_RENDERER_URL']))
    if (isInternal) return
    if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  win.on('closed', () => {
    mainWindow = null
    if (!isDevMode) app.dock?.hide()
  })

  return win
}

function buildApplicationMenu(): Menu {
  const platformMenus: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: 'Spool',
          submenu: [
            { role: 'about', label: 'About Spool' },
            { type: 'separator' },
            { role: 'hide', label: 'Hide Spool' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit Spool' },
          ],
        },
      ]
    : [
        {
          label: 'Spool',
          submenu: [
            { role: 'about', label: 'About Spool' },
            { type: 'separator' },
            { role: 'quit', label: 'Quit Spool' },
          ],
        },
      ]

  return Menu.buildFromTemplate([
    ...platformMenus,
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ])
}

let activeSyncPromise: Promise<{ added: number; updated: number; errors: number }> | null = null

function runSyncWorker(): Promise<{ added: number; updated: number; errors: number }> {
  if (activeSyncPromise) return activeSyncPromise

  activeSyncPromise = new Promise<{ added: number; updated: number; errors: number }>((resolve, reject) => {
    const workerPath = join(__dirname, 'sync-worker.js')
    const worker = new Worker(workerPath)
    worker.on('message', (msg: SyncWorkerMessage) => {
      if (msg.type === 'progress') {
        isSyncActive = msg.data.phase !== 'done'
        searchCache.clear()
        mainWindow?.webContents.send('spool:sync-progress', msg.data)
      } else if (msg.type === 'done') {
        isSyncActive = false
        searchCache.clear()
        resolve(msg.result)
      } else if (msg.type === 'error') {
        isSyncActive = false
        reject(new Error(msg.error))
      }
    })
    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Sync worker exited with code ${code}`))
    })
  }).finally(() => {
    activeSyncPromise = null
  })

  return activeSyncPromise
}

app.whenReady().then(async () => {
  // Hydrate the agent-binary path cache from disk before anything has a
  // chance to call `cachedResolveAsync`. Without this every cold launch
  // re-runs `<user-shell> -ilc 'command -v ...'` once per agent — three
  // serialised execSync-style spawns on a slow .zshrc are the dominant
  // contributor to the launch beachball.
  hydrateBinaryCache()

  // Set dock icon (dev mode doesn't pick up build config)
  const dockIconPath = join(__dirname, '../../resources/icon.icns')
  try { app.dock?.setIcon(nativeImage.createFromPath(dockIconPath)) } catch {}

  Menu.setApplicationMenu(buildApplicationMenu())

  db = getDB()
  acpManager = new AcpManager()

  syncer = new Syncer(db, undefined, (sessionId) => {
    // Sync mutated this session's messages; existing findings now have
    // stale offsets. The Syncer already nulled scan_profile inside the
    // commit txn; here we just re-enqueue so the worker picks it up —
    // unless the user opted out of auto-rescan in Settings → Security,
    // in which case we leave scan_profile dirty for the next manual
    // Rescan all click.
    // `invalidateSessionScanProfile` updates the v12 `scan_profile`
    // column regardless of the feature flag — the column lives in
    // every user's schema. Re-enqueuing only runs when the worker
    // is booted (i.e. the flag is on); the column resets either
    // way, which keeps state consistent if the flag flips on later.
    invalidateSessionScanProfile(db, sessionId)
    if (scanWorker && loadSecurityPreferences().rescanAfterSync === 'auto') {
      // Promise-shaped so a worker-thread rejection (e.g. the child
      // died) surfaces in the log instead of vanishing silently
      // through Effect.runFork. The Effect itself is failure-free
      // shape (Effect<void, never>) — `.catch` here is the safety
      // net for runtime promise rejections from the underlying
      // postMessage round-trip.
      runWithObservability(scanWorker.enqueue(sessionId)).catch((err) => {
        console.error('[security] scan-worker enqueue failed:', err)
      })
    }
  })
  watcher = new SpoolWatcher(syncer)
  watcher.on('new-sessions', (_event, data) => {
    searchCache.clear()
    mainWindow?.webContents.send('spool:new-sessions', data)
  })
  watcher.on('error', (_event, data) => {
    console.error('[watcher]', data.error, data.root ? `(root=${data.root})` : '')
  })

  // Initial sync in worker thread (non-blocking)
  runSyncWorker().then((result) => {
    watcher.start()
    // Sessions were inserted by the worker thread which has its own
    // DB handle, so the renderer never got an onNewSessions push for
    // them. Without an explicit signal here, any view that listed
    // sessions BEFORE sync finished would stay empty until the next
    // file-watcher event. Emit new-sessions so LibraryLanding /
    // ProjectView refetch — same code path that already handles
    // post-startup inserts.
    if (result.added > 0) {
      mainWindow?.webContents.send('spool:new-sessions', { count: result.added })
    }
    // Sessions were inserted by the worker thread which has its own DB
    // handle — no onSessionChanged callbacks reached this process. Kick
    // off a backfill round now that the sessions table is populated.
    if (scanWorker) {
      runWithObservability(scanWorker.backfill()).catch((err) => {
        console.error('[security] post-sync backfill failed:', err)
      })
    }
  }).catch((err) => {
    console.error('[sync-worker] failed:', err)
  })

  mainWindow = createWindow()

  // Boot the Security Scan worker AFTER createWindow so the renderer
  // mount + initial sync don't wait on it. The Syncer's
  // onSessionChanged callback and the post-sync backfill are both
  // guarded by `if (scanWorker)`, so any session changes that fire
  // before the worker is ready are no-ops — `scanWorker.backfill()`
  // below catches up once boot completes.
  //
  // Gated by VITE_FEATURE_SECURITY so production builds (where the
  // env var stays unset) never start the scanner.
  if (securityFeatureEnabled()) {
    // Register the readiness IPC eagerly so the renderer can wait for
    // (or banner against) the worker boot. Without this, any Settings
    // → Security or SecurityPage mount during the boot window hit
    // unregistered handlers and surfaced as raw "No handler registered
    // for security:..." errors.
    const readiness = registerSecurityReadinessIpc(() => mainWindow)
    setSecurityReadiness = readiness.setReadiness
    disposeSecurityReadinessIpc = readiness.dispose

    // Has to happen post-ready (uses protocol.handle + app.getPath).
    registerPfModelProtocol()
    // Electron's `net.fetch` honours system proxy + custom CA bundle;
    // globalThis.fetch (undici) bypasses both. Per bug_electron_proxy
    // memory: stealer logs / corp proxies / mainland China all need
    // this for outbound HF traffic.
    //
    // E2E exception: when SPOOL_E2E_TEST is set, replace the fetch
    // with an immediate-503 fake. The PF download e2e wants to
    // verify the click → IPC → state-machine wiring, not network
    // behaviour — the state machine's logic itself is fully covered
    // by pf-coordinator.test.ts with injected fakes. Going to a real
    // HF URL made the e2e flaky because the failure path waits on a
    // network roundtrip whose latency we don't control. The fake
    // resolves synchronously, so the state machine transitions
    // not-installed → downloading → failed in milliseconds and the
    // wiring assertion becomes deterministic.
    const pfFetchImpl: typeof globalThis.fetch = process.env['SPOOL_E2E_TEST'] === '1'
      ? (async () => new Response(null, { status: 503, statusText: 'e2e-fake' })) as typeof globalThis.fetch
      : ((url, init) => net.fetch(url as string, init)) as typeof globalThis.fetch
    pfCoordinator = makePfCoordinator({
      modelDir: pfModelDir(),
      fetch: pfFetchImpl,
      run: runWithObservability,
    })
    // When a download initiated from the callout completes, finish
    // the activation handshake on the user's behalf — flip pfEnabled
    // so syncPfRuntime spawns the inference window + kicks backfill.
    // The callout self-renders an "Activating..." state until
    // syncPfRuntime clears pfActivationPending below.
    pfCoordinator.subscribe((s) => {
      if (s.phase !== 'installed') return
      const prefs = loadSecurityPreferences()
      if (!prefs.pfActivationPending || prefs.pfEnabled) return
      void (async () => {
        const next = saveSecurityPreferences({ pfEnabled: true })
        mainWindow?.webContents.send(SECURITY_IPC_CHANNELS.EVT_PREFS_CHANGED, next)
        await syncPfRuntime(true).catch((err) => {
          console.error('[security] callout-driven activation failed:', err)
        })
      })()
    })
    void bootScanWorker().then(() => {
      if (!scanWorker) {
        setSecurityReadiness?.({ ready: false, reason: 'scanner-unavailable' })
        return
      }
      disposeSecurityIpc = registerSecurityIpc({
        db,
        worker: scanWorker,
        runPromise: runWithObservability,
        getMainWindow: () => mainWindow,
        pfCoordinator,
        pfRuntime,
        onPfEnabledChanged: (enabled) => {
          void syncPfRuntime(enabled).catch((err) => {
            console.error('[security] pf runtime transition failed:', err)
          })
        },
      })
      setSecurityReadiness?.({ ready: true })
      runWithObservability(scanWorker.backfill()).catch((err) => {
        console.error('[security] boot backfill failed:', err)
      })
      // If the user enabled PF before this app launch, bring the
      // inference window up now that the rest of Spool is booted.
      if (loadSecurityPreferences().pfEnabled) {
        void syncPfRuntime(true).catch((err) => {
          console.error('[security] pf runtime boot failed:', err)
        })
      }
    })
  }

  // Auto-updater (only runs in packaged builds)
  setupAutoUpdater(() => mainWindow)


  function showOrCreateWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
    } else {
      mainWindow = createWindow()
    }
    app.dock?.show()
  }
  focusExistingWindow = showOrCreateWindow

  if (!isDevMode) {
    setupTray(showOrCreateWindow, () => {
      runSyncWorker()
    })
  }

  app.on('activate', showOrCreateWindow)
}).catch((err) => {
  // Without this catch, any rejection from the startup sequence becomes an
  // unhandled promise rejection — Node 20+ terminates the process with SIGTRAP,
  // producing an opaque EXC_BREAKPOINT crash with only `PromiseRejectCallback`
  // in the stack. Logging the error here gives users something actionable.
  console.error('[startup] fatal error during app initialization:', err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  dialog.showErrorBox('Spool failed to start', err instanceof Error ? err.message : String(err))
  app.exit(1)
})

app.on('window-all-closed', () => {
  if (isDevMode) {
    app.quit()
    return
  }
  // On macOS, keep app running in tray
  app.dock?.hide()
})

app.on('before-quit', (event) => {
  // Tear down the scan worker thread before Electron releases the
  // database — the thread holds its own DB handle and needs a clean
  // Scope.close to drop it.
  if (scanWorker) {
    event.preventDefault()
    shutdownScanWorker()
      .catch((err) => { console.error('[security] shutdown failed:', err) })
      .finally(() => { app.exit(0) })
  }
})

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('spool:search', (_e, { query, limit = 10, source, onlyPinned, identityKey }: { query: string; limit?: number; source?: string; onlyPinned?: boolean; identityKey?: string }) => {
  const cacheKey = `${source ?? 'all'}|${identityKey ?? 'any'}|${limit}|${onlyPinned ? 'pinned' : 'full'}|${query}`
  if (!isSyncActive) {
    const cached = searchCache.get(cacheKey)
    if (cached) return cached
  }

  const sessionSource = source === 'claude' || source === 'codex' || source === 'gemini' || source === 'opencode'
    ? source
    : undefined
  const results = searchFragments(db, query, {
    limit,
    ...(sessionSource ? { source: sessionSource } : {}),
    ...(onlyPinned ? { onlyPinned: true } : {}),
    ...(identityKey ? { identityKey } : {}),
  }).map(f => ({ ...f, kind: 'fragment' as const }))

  if (!isSyncActive) {
    searchCache.set(cacheKey, results)
  }

  return results
})

ipcMain.handle('spool:search-preview', (_e, { query, limit = 5, source }: { query: string; limit?: number; source?: string }) => {
  const cacheKey = `preview|${source ?? 'all'}|${limit}|${query}`
  const cached = searchCache.get(cacheKey)
  if (cached) return cached

  const sessionSource = source === 'claude' || source === 'codex' || source === 'gemini' || source === 'opencode'
    ? source
    : undefined
  const fragments = searchSessionPreview(db, query, {
    limit,
    ...(sessionSource ? { source: sessionSource } : {}),
  }).map(f => ({ ...f, kind: 'fragment' as const }))
  searchCache.set(cacheKey, fragments)
  return fragments
})

ipcMain.handle('spool:list-sessions', (_e, args: { limit?: number; cursor?: SessionsCursor } = {}) => {
  return listRecentSessionsPage(db, args)
})

ipcMain.handle('spool:list-project-groups', () => {
  return listProjectGroups(db)
})

ipcMain.handle('spool:list-sessions-by-identity', (_e, { identityKey, options }: { identityKey: string; options?: ListSessionsByIdentityOptions }) => {
  return listSessionsByIdentity(db, identityKey, options)
})

ipcMain.handle('spool:list-project-directory-counts', (_e, { identityKey, sources }: { identityKey: string; sources?: SessionSource[] }) => {
  return listProjectDirectoryCounts(db, identityKey, sources ? { sources } : {})
})

ipcMain.handle('spool:get-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return getSessionWithMessages(db, sessionUuid)
})

ipcMain.handle('spool:get-status', () => {
  return getStatus(db)
})

ipcMain.handle('spool:pin-session', (_e, { uuid }: { uuid: string }) => {
  pinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:unpin-session', (_e, { uuid }: { uuid: string }) => {
  unpinSession(db, uuid)
  searchCache.clear()
  return { ok: true }
})

ipcMain.handle('spool:get-pinned-uuids', () => {
  return getPinnedUuids(db)
})

ipcMain.handle('spool:list-pinned-sessions', () => {
  return listPinnedSessions(db)
})

ipcMain.handle('spool:list-pinned-sessions-by-identity', (_e, { identityKey }: { identityKey: string }) => {
  return listPinnedSessionsByIdentity(db, identityKey)
})

ipcMain.handle('spool:list-share-drafts', (_e, { limit }: { limit?: number } = {}) => {
  const opts: { limit?: number } = {}
  if (limit !== undefined) opts.limit = limit
  return listShareDrafts(db, opts)
})

ipcMain.handle('spool:get-share-draft', (_e, { draftId }: { draftId: string }) => {
  return getShareDraft(db, draftId)
})

ipcMain.handle('spool:upsert-share-draft', (_e, { input }: { input: UpsertShareDraftInput }) => {
  upsertShareDraft(db, input)
  return { ok: true }
})

ipcMain.handle('spool:delete-share-draft', (_e, { draftId }: { draftId: string }) => {
  deleteShareDraft(db, draftId)
  return { ok: true }
})

ipcMain.handle('spool:count-drafts-by-session', (_e, { sessionUuid }: { sessionUuid: string }) => {
  return countDraftsBySession(db, sessionUuid)
})

ipcMain.handle('spool:get-runtime-info', () => {
  return {
    isDev: isDevMode,
    appPath: app.getAppPath(),
    appName: app.getName(),
  }
})

ipcMain.handle('spool:get-system-locale', () => {
  // app.getLocale() can return tags like "zh-CN", "zh-Hans-CN", "zh-TW",
  // "zh-Hant-HK". Normalize to one of Spool's supported locales — script
  // subtag wins when present (zh-Hans → zh-CN, zh-Hant → zh-TW), otherwise
  // fall back to region. Everything else lands on English.
  const raw = app.getLocale().toLowerCase()
  if (raw.startsWith('zh')) {
    if (raw.includes('hans')) return 'zh-CN'
    if (raw.includes('hant')) return 'zh-TW'
    if (raw.includes('-tw') || raw.includes('-hk') || raw.includes('-mo')) return 'zh-TW'
    return 'zh-CN'
  }
  if (raw.startsWith('ja')) return 'ja'
  if (raw.startsWith('ko')) return 'ko'
  if (raw.startsWith('de')) return 'de'
  if (raw.startsWith('fr')) return 'fr'
  return 'en'
})

ipcMain.handle('spool:sync-now', () => {
  return runSyncWorker()
})

ipcMain.handle('spool:resume-cli', (_e, { sessionUuid, source, cwd }: { sessionUuid: string; source: string; cwd?: string }) => {
  try {
    const command = getSessionResumeCommand(source, sessionUuid)
    if (!command) {
      return { ok: false, error: `Session source "${source}" cannot be resumed from the CLI.` }
    }
    const session = getSessionWithMessages(db, sessionUuid)?.session
    const resumeCwd = session
      ? resolveResumeWorkingDirectory(session)
      : resolveResumeWorkingDirectory({
          source: source as SessionSource,
          cwd: cwd ?? null,
          projectDisplayPath: '',
          filePath: '',
        })
    const terminal = acpManager.getAgentsConfig().terminal
    openTerminal(command, terminal, resumeCwd)
    return { ok: true }
  } catch (err) {
    console.error('[spool:resume-cli]', err)
    return { ok: false, error: String(err) }
  }
})

ipcMain.handle('spool:copy-fragment', (_e, { text }: { text: string }) => {
  const { clipboard } = require('electron')
  clipboard.writeText(text)
  return { ok: true }
})

ipcMain.handle('spool:get-theme', () => {
  return nativeTheme.themeSource
})

ipcMain.handle('spool:set-theme', (_e, { theme }: { theme: 'system' | 'light' | 'dark' }) => {
  uiPreferences.themeSource = theme
  nativeTheme.themeSource = theme
  saveThemeSource(theme)
  return { ok: true }
})

ipcMain.handle('spool:get-theme-editor-state', () => {
  return uiPreferences.themeEditor
})

ipcMain.handle('spool:set-theme-editor-state', (_e, { state }: { state: import('../renderer/theme/editorTypes.js').ThemeEditorStateV1 }) => {
  uiPreferences.themeEditor = state
  saveThemeEditor(state)
  return { ok: true }
})

// ── AI / ACP Handlers ────────────────────────────────────────────────────────

ipcMain.handle('spool:ai-agents', () => {
  return acpManager.detectAgents()
})

ipcMain.handle('spool:ai-builtin-agents', () => {
  return acpManager.getBuiltinAgents()
})

ipcMain.handle('spool:ai-get-config', () => {
  return acpManager.getAgentsConfig()
})

ipcMain.handle('spool:ai-set-config', (_e, { config }: { config: import('./acp.js').AgentsConfig }) => {
  acpManager.saveAgentsConfig(config)
  return { ok: true }
})

ipcMain.handle('spool:ai-search', async (_e, { query, agentId, context }: { query: string; agentId: string; context: import('@spool-lab/core').FragmentResult[] }) => {
  try {
    const fullText = await acpManager.query(agentId, query, context, (text) => {
      mainWindow?.webContents.send('spool:ai-chunk', { text })
    }, (toolCall) => {
      mainWindow?.webContents.send('spool:ai-tool-call', toolCall)
    }, (info) => {
      mainWindow?.webContents.send('spool:ai-session-started', info)
    })
    mainWindow?.webContents.send('spool:ai-done', { fullText })
    return { ok: true, fullText }
  } catch (err) {
    const error = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : String(err)
    console.error('[spool:ai-search] Agent query failed:', error)
    if (err instanceof Error && err.stack) console.error(err.stack)
    mainWindow?.webContents.send('spool:ai-done', { fullText: '', error })
    return { ok: false, error }
  }
})

ipcMain.handle('spool:ai-cancel', () => {
  acpManager.cancel()
  return { ok: true }
})

ipcMain.handle('spool:get-sidebar-collapsed', (): boolean => {
  return uiPreferences.sidebarCollapsed
})

ipcMain.handle('spool:set-sidebar-collapsed', (_e, { collapsed }: { collapsed: boolean }) => {
  uiPreferences.sidebarCollapsed = collapsed
  saveSidebarCollapsed(collapsed)
  return { ok: true }
})

// ── Auto-update ──────────────────────────────────────────────────────────

ipcMain.handle('spool:download-update', () => {
  downloadUpdate()
})

ipcMain.handle('spool:install-update', () => {
  quitAndInstall()
})

// Share editor PDF export — render the artifact in a hidden
// BrowserWindow that contains ONLY the cloned target element, then
// printToPDF that window. Targeting an isolated window (instead of
// trying to scope the main renderer with @media print rules) sidesteps
// all the CSS/layout interference that comes from sharing a page with
// the rest of the Spool app — body width, Tailwind utilities, React
// portals, the works. The hidden window loads the same renderer URL
// (so the same CSS bundle is available), then swaps its body for the
// caller-supplied HTML, waits for fonts, and prints.
// A4 page width @ 96dpi. We reflow the cloned artifact to this width
// so it fills the page edge-to-edge (no left/right gutter), then
// printToPDF at A4 — Chromium paginates vertically as content runs.
const A4_PAGE_WIDTH_PX = 794
ipcMain.handle(
  'spool:print-to-pdf',
  async (e, args: { html: string; widthPx: number; heightPx: number }): Promise<Uint8Array> => {
    const callerUrl = e.sender.getURL()
    const printWin = new BrowserWindow({
      show: false,
      width: A4_PAGE_WIDTH_PX,
      height: 1123,
      useContentSize: true,
      webPreferences: { sandbox: false, offscreen: true },
    })
    try {
      await printWin.loadURL(callerUrl)
      await printWin.webContents.executeJavaScript(`(async () => {
        document.body.innerHTML = ${JSON.stringify(args.html)}
        document.body.style.cssText = 'margin:0;padding:0;background:white;width:${A4_PAGE_WIDTH_PX}px;overflow:visible;height:auto;'
        document.documentElement.style.cssText = 'margin:0;padding:0;background:white;width:${A4_PAGE_WIDTH_PX}px;overflow:visible;height:auto;'
        const artifact = document.body.firstElementChild
        if (artifact) {
          artifact.style.width = '${A4_PAGE_WIDTH_PX}px'
          artifact.style.maxWidth = '${A4_PAGE_WIDTH_PX}px'
        }
        await document.fonts.ready
      })()`)
      const buf = await printWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      })
      return new Uint8Array(buf)
    } finally {
      printWin.destroy()
    }
  },
)

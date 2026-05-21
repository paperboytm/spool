// Owns the ModelHost lifecycle on the main side. `start()` builds a
// fresh Scope and mounts the ModelHost; `stop()` closes the Scope so
// the hidden BrowserWindow is destroyed and in-flight analyze fibers
// are interrupted. Both calls are idempotent.
//
// Triggered by the SET_PREFS IPC handler when pfEnabled flips, gated
// against model installation — no point spawning the window if the
// ONNX weights aren't on disk yet.

import { Effect, Exit, Scope } from 'effect'
import { BrowserWindow, app, ipcMain } from 'electron'
import { join } from 'node:path'
import { makeModelHost, type ModelHost, type ModelHostDeps, type PfState } from './model-host.js'
import { MODEL_MANIFEST } from './model-manifest.js'
import { pfInstallStatus } from './model-state.js'
import { pfModelDir } from './model-paths.js'

export interface PfRuntime {
  isActive(): boolean
  getState(): Promise<PfState | null>
  /** Mount the inference window. No-op if already running. Resolves
   *  once handshake settles (either to ready or failed). */
  start(): Promise<void>
  /** Tear down the inference window. No-op if not running. */
  stop(): Promise<void>
  /** Run a single analyze through the active host, or null if the
   *  host isn't running. */
  analyze(text: string): Promise<unknown[]>
}

export interface PfRuntimeDeps {
  /** Override window factory + paths for tests. */
  spawnWindow?: () => Promise<BrowserWindow>
  /** Override `ipcMain` for tests. */
  ipc?: ModelHostDeps['ipc']
}

export function makePfRuntime(deps: PfRuntimeDeps = {}): PfRuntime {
  let host: ModelHost | null = null
  let scope: Scope.CloseableScope | null = null
  let starting: Promise<void> | null = null

  const spawnWindow = deps.spawnWindow ?? defaultSpawnWindow
  const ipc = deps.ipc ?? ipcMain

  async function start(): Promise<void> {
    if (host) return
    if (starting) return starting
    starting = (async () => {
      const fresh = await Effect.runPromise(Scope.make())
      const builtHost = await Effect.runPromise(
        Effect.provideService(
          makeModelHost({ spawnWindow, ipc }),
          Scope.Scope,
          fresh,
        ),
      )
      host = builtHost
      scope = fresh
    })().finally(() => { starting = null })
    await starting
  }

  async function stop(): Promise<void> {
    const s = scope
    host = null
    scope = null
    if (s) await Effect.runPromise(Scope.close(s, Exit.void))
  }

  async function getState(): Promise<PfState | null> {
    if (!host) return null
    return Effect.runPromise(host.getState)
  }

  async function analyze(text: string): Promise<unknown[]> {
    if (!host) return []
    return Effect.runPromise(
      host.analyze(text).pipe(Effect.catchAll(() => Effect.succeed<unknown[]>([]))),
    )
  }

  return {
    isActive: () => host !== null,
    getState,
    start,
    stop,
    analyze,
  }
}

/** Returns true when the inference window has weights it can load. */
export function pfModelInstalled(): boolean {
  return pfInstallStatus(pfModelDir(), MODEL_MANIFEST).status === 'installed'
}

async function defaultSpawnWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/inference.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  // Prod: electron-vite emits pf-inference.html under out/renderer/.
  // Dev: ELECTRON_RENDERER_URL points at src/renderer/, so climb one
  // level up to reach src/inference/pf-inference.html.
  const rendererBase = process.env['ELECTRON_RENDERER_URL']
  if (rendererBase) {
    await win.loadURL(`${rendererBase}/../inference/pf-inference.html`)
  } else {
    await win.loadFile(join(app.getAppPath(), 'out/renderer/pf-inference.html'))
  }
  return win
}

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

/** Document title set by `src/renderer/pf-inference.html` — used as a
 *  runtime invariant after dev loadURL, to detect Vite SPA fallback
 *  (would deliver main renderer's index.html with title "Spool"). */
export const INFERENCE_DOC_TITLE = 'Spool · PF inference'
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
  /** Effect runner that carries the main-process observability
   *  layer. Defaults to bare `Effect.runPromise` for tests; main
   *  passes `runWithObservability` so PF spans land in the same
   *  OTel pipeline as scan-worker / sync-worker / IPC spans. */
  run?: <A, E>(eff: Effect.Effect<A, E>) => Promise<A>
}

export function makePfRuntime(deps: PfRuntimeDeps = {}): PfRuntime {
  let host: ModelHost | null = null
  let scope: Scope.CloseableScope | null = null
  let starting: Promise<void> | null = null

  const spawnWindow = deps.spawnWindow ?? defaultSpawnWindow
  const ipc = deps.ipc ?? ipcMain
  // Cast: Effect.runPromise's generic shape is wider than what we
  // need (it also accepts a Scope.Scope requirement). The override
  // pin to <A, E> matches what main supplies.
  const run = (deps.run ?? Effect.runPromise) as <A, E>(eff: Effect.Effect<A, E>) => Promise<A>

  async function start(): Promise<void> {
    if (host) return
    if (starting) return starting
    starting = run(
      Effect.gen(function* () {
        const fresh = yield* Scope.make()
        const builtHost = yield* Effect.provideService(makeModelHost({ spawnWindow, ipc }), Scope.Scope, fresh)
        host = builtHost
        scope = fresh
        // Annotate after we have a state — useful when scrolling OTel
        // for "what runtime did we land on this start cycle".
        const settled = yield* builtHost.getState
        yield* Effect.annotateCurrentSpan('pf.status', settled.status)
        if (settled.runtime) yield* Effect.annotateCurrentSpan('pf.runtime', settled.runtime)
        if (settled.adapterLabel) yield* Effect.annotateCurrentSpan('pf.adapter', settled.adapterLabel)
        if (settled.error) yield* Effect.annotateCurrentSpan('pf.error', settled.error)
      }).pipe(Effect.withSpan('pf.runtime.start')),
    ).finally(() => { starting = null })
    await starting
  }

  async function stop(): Promise<void> {
    const s = scope
    host = null
    scope = null
    if (s) {
      await run(Scope.close(s, Exit.void).pipe(Effect.withSpan('pf.runtime.stop')))
    }
  }

  async function getState(): Promise<PfState | null> {
    if (!host) return null
    return run(host.getState)
  }

  async function analyze(text: string): Promise<unknown[]> {
    if (!host) return []
    return run(
      host.analyze(text).pipe(
        Effect.tap((matches) =>
          Effect.annotateCurrentSpan('pf.matches', matches.length)),
        Effect.catchAll((err) =>
          Effect.annotateCurrentSpan('pf.error', String(err.cause)).pipe(
            Effect.as<unknown[]>([]),
          )),
        Effect.withSpan('pf.analyze', { attributes: { text_len: text.length } }),
      ),
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
  // The inference renderer is hidden, so its console + uncaught
  // exceptions never surface otherwise. Without this forward,
  // transformers.js / ONNX failures look like a stuck handshake from
  // main's POV. Production logs land in the same OTel pipeline that
  // captures other main-side console output.
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const tag = level >= 2 ? 'ERR' : level === 1 ? 'WARN' : 'LOG'
    console.log(`[pf-inference ${tag}]`, message, sourceId ? `(${sourceId}:${line})` : '')
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[pf-inference] render process gone:', details.reason, details.exitCode)
  })
  // Prod: electron-vite emits pf-inference.html under out/renderer/.
  // Dev: Vite roots the renderer at src/renderer/, where the HTML
  // also actually lives — `src/renderer/pf-inference.html`. Earlier
  // revisions of this file pointed at `src/inference/...` (where the
  // companion .ts entry lives), but no such HTML exists; Vite would
  // silently fall through to its SPA fallback and serve the main
  // renderer's index.html into this hidden window. The symptom: the
  // window booted as a second copy of the main App (Sidebar /
  // LibraryLanding `Cannot read properties of undefined`), the
  // `pf:ready` handshake never fired, `pfRuntime.start()` hung, and
  // every Security rescan silently downgraded to regex-only.
  //
  // Devtools are opt-in via SPOOL_PF_DEVTOOLS=1 — the console-message
  // forwarder above already pipes pf-inference logs into main's
  // stdout, so a detached devtools window every restart is just noise
  // unless we're actively debugging this surface.
  const rendererBase = process.env['ELECTRON_RENDERER_URL']
  if (rendererBase) {
    if (process.env['SPOOL_PF_DEVTOOLS']) {
      win.webContents.openDevTools({ mode: 'detach' })
    }
    await win.loadURL(`${rendererBase.replace(/\/$/, '')}/pf-inference.html`)
    // Runtime invariant — catches a class of silent failures that bit
    // us through PR #294 / #296 squashes: if the URL above resolves to
    // anything Vite can't serve (file moved, vite config out of sync,
    // path typo'd), the dev server's SPA fallback returns the main
    // renderer's index.html instead. The hidden window then mounts the
    // entire main App, fails fast inside <Sidebar>/<LibraryLanding>
    // (no `window.spool` in this preload), and pf:ready never fires —
    // pfRuntime.start() hangs and every Security rescan silently
    // downgrades to regex-only. Checking the loaded document title is
    // O(1), unambiguous, and surfaces the issue at boot instead of
    // weeks later when someone notices the missing PF pill.
    const title = (await win.webContents.executeJavaScript('document.title')) as string
    if (title !== INFERENCE_DOC_TITLE) {
      throw new Error(
        `[pf-runtime] dev loadURL returned wrong document (title=${JSON.stringify(title)}; ` +
        `expected ${JSON.stringify(INFERENCE_DOC_TITLE)}). The Vite dev server probably hit ` +
        `its SPA fallback — check src/renderer/pf-inference.html exists and that the load URL ` +
        `points at it.`,
      )
    }
  } else {
    await win.loadFile(join(app.getAppPath(), 'out/renderer/pf-inference.html'))
  }
  return win
}

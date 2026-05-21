// ModelHost — Effect Scoped resource that owns the hidden BrowserWindow
// running the Privacy Filter inference renderer.
//
// WebGPU is renderer-only in Chromium, so main can't run it directly.
// The hidden window loads `pf-inference.html`, detects WebGPU (with
// WASM fallback), and reports back via the `pf:ready` IPC channel.
// PR 5a covers lifecycle + handshake only; model download lands in 5b
// and `pf:analyze` in 5c.

import { Effect, Ref, Data, Scope } from 'effect'
import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'
import { PF_IPC, type PfReadyMessage, type PfFailedMessage, type PfRuntime } from '../../inference/types.js'

export type { PfRuntime }

export interface PfState {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  runtime: PfRuntime | null
  adapterLabel?: string
  detectionMs?: number
  error?: string
}

export class ModelHostError extends Data.TaggedError('ModelHostError')<{
  readonly stage: 'spawn' | 'load' | 'handshake' | 'analyze' | 'shutdown'
  readonly cause: unknown
}> {}

export interface PfMatchResult {
  /** PF-class label, e.g. 'person', 'email'. */
  class: string
  value: string
  start: number
  end: number
  score: number
}

export interface ModelHost {
  /** True only when the hidden window is up and the handshake succeeded. */
  ready: Effect.Effect<boolean>
  /** Current renderer runtime once the window reports it. */
  getRuntime: Effect.Effect<PfRuntime | null>
  /** Current high-level state for Settings UI consumption. */
  getState: Effect.Effect<PfState>
  /** Analyse a chunk of text. PR 5a stub: returns []. Real impl lands in 5c. */
  analyze: (text: string) => Effect.Effect<PfMatchResult[], ModelHostError>
}

export interface ModelHostDeps {
  /** Creates and returns a hidden BrowserWindow already loading
   *  `pf-inference.html`. The acquire path awaits the ready handshake
   *  on `event.sender.id` matching `webContents.id`. */
  spawnWindow: () => Promise<BrowserWindow>
  /** Timeout for the ready handshake. Default 10 s. */
  readyTimeoutMs?: number
  /** Override for tests — defaults to Electron's `ipcMain`. */
  ipc?: Pick<typeof ipcMain, 'on' | 'removeListener'>
}

/** Build a ModelHost as a Scoped resource. Scope-acquired spawns the
 *  hidden window and waits for `pf:ready`; scope-closed destroys it.
 *
 *  The Effect succeeds even when the handshake fails — state goes to
 *  `failed` and `ready` stays false. Callers check `getState` before
 *  enabling pf in the UI, so a failed spawn doesn't tear the whole
 *  app down. */
export function makeModelHost(
  deps: ModelHostDeps,
): Effect.Effect<ModelHost, never, Scope.Scope> {
  return Effect.gen(function* () {
    const ipc = deps.ipc ?? ipcMain
    const readyTimeoutMs = deps.readyTimeoutMs ?? 10_000
    const stateRef = yield* Ref.make<PfState>({ status: 'loading', runtime: null })

    const failWith = (err: unknown) =>
      Ref.set(stateRef, {
        status: 'failed',
        runtime: null,
        error: err instanceof ModelHostError ? String(err.cause) : String(err),
      })

    yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const w = yield* Effect.tryPromise({
          try: () => deps.spawnWindow(),
          catch: (cause) => new ModelHostError({ stage: 'spawn', cause }),
        }).pipe(Effect.catchAll((err) => failWith(err).pipe(Effect.as(null))))
        if (!w) return null

        const handshake = yield* Effect.tryPromise({
          try: () => awaitReady(ipc, w, readyTimeoutMs),
          catch: (cause) => new ModelHostError({ stage: 'handshake', cause }),
        }).pipe(Effect.catchAll((err) => failWith(err).pipe(Effect.as(null))))

        if (handshake?.kind === 'ready') {
          const s: PfState = {
            status: 'ready',
            runtime: handshake.runtime,
            detectionMs: handshake.detectionMs,
          }
          if (handshake.adapterLabel !== undefined) s.adapterLabel = handshake.adapterLabel
          yield* Ref.set(stateRef, s)
        } else if (handshake?.kind === 'failed') {
          yield* Ref.set(stateRef, {
            status: 'failed',
            runtime: null,
            error: handshake.message,
          })
        }
        return w
      }),
      (w) =>
        Effect.sync(() => {
          if (w && !w.isDestroyed()) w.destroy()
        }),
    )

    return {
      ready: Ref.get(stateRef).pipe(Effect.map((s) => s.status === 'ready')),
      getRuntime: Ref.get(stateRef).pipe(Effect.map((s) => s.runtime)),
      getState: Ref.get(stateRef),
      // PR 5a stub. Real impl lands in PR 5c once `pf:analyze` ships.
      analyze: (_text: string) => Effect.succeed<PfMatchResult[]>([]),
    }
  })
}

type HandshakeOutcome =
  | { kind: 'ready'; runtime: PfRuntime; adapterLabel?: string; detectionMs: number }
  | { kind: 'failed'; message: string }

/** Wait for the first `pf:ready` (or `pf:failed`) from this exact
 *  webContents. Other windows' messages are ignored so a second
 *  ModelHost (or some unrelated subsystem firing the same channel)
 *  can't satisfy this one's handshake. */
function awaitReady(
  ipc: Pick<typeof ipcMain, 'on' | 'removeListener'>,
  win: BrowserWindow,
  timeoutMs: number,
): Promise<HandshakeOutcome> {
  return new Promise((resolve) => {
    const targetId = win.webContents.id
    let settled = false
    const settle = (value: HandshakeOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      ipc.removeListener(PF_IPC.READY, onReady)
      ipc.removeListener(PF_IPC.FAILED, onFailed)
      resolve(value)
    }
    const onReady = (event: IpcMainEvent, payload: PfReadyMessage) => {
      if (event.sender.id !== targetId) return
      settle({
        kind: 'ready',
        runtime: payload.runtime,
        ...(payload.adapterLabel !== undefined ? { adapterLabel: payload.adapterLabel } : {}),
        detectionMs: payload.detectionMs,
      })
    }
    const onFailed = (event: IpcMainEvent, payload: PfFailedMessage) => {
      if (event.sender.id !== targetId) return
      settle({ kind: 'failed', message: payload.message })
    }
    const timer = setTimeout(
      () => settle({ kind: 'failed', message: `pf:ready handshake timed out after ${timeoutMs}ms` }),
      timeoutMs,
    )
    ipc.on(PF_IPC.READY, onReady)
    ipc.on(PF_IPC.FAILED, onFailed)
  })
}

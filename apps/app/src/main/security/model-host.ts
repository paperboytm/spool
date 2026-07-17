// ModelHost — Effect Scoped resource that owns the hidden BrowserWindow
// running the Privacy Filter inference renderer.
//
// WebGPU is renderer-only in Chromium, so main can't run it directly.
// The hidden window loads `pf-inference.html`, detects WebGPU (with
// WASM fallback), reports readiness via `pf:ready`, and answers
// `pf:analyze-request` correlated by `reqId`.

import { Effect, Ref, Data, Scope } from 'effect'
import { ipcMain, type BrowserWindow, type IpcMainEvent } from 'electron'
import {
  PF_IPC,
  type PfReadyMessage, type PfFailedMessage, type PfRuntime,
  type PfAnalyzeRequest, type PfAnalyzeResult,
} from '../../renderer/inference/types.js'

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
  /** Analyse a chunk of text. Fails with ModelHostError if the host
   *  isn't ready, the request times out, or the inference side errors. */
  analyze: (text: string) => Effect.Effect<PfMatchResult[], ModelHostError>
}

export interface ModelHostDeps {
  /** Creates and returns a hidden BrowserWindow already loading
   *  `pf-inference.html`. The acquire path awaits the ready handshake
   *  on `event.sender.id` matching `webContents.id`. */
  spawnWindow: () => Promise<BrowserWindow>
  /** Timeout for the ready handshake. Default 10 s. */
  readyTimeoutMs?: number
  /** Per-analyse timeout. Default 30 s — generous because WASM
   *  inference on cold cache can run 10-30 s per session. */
  analyzeTimeoutMs?: number
  /** Override for tests — defaults to Electron's `ipcMain`. */
  ipc?: Pick<typeof ipcMain, 'on' | 'removeListener'>
  /** Invoked when the inference renderer's process is gone after the
   *  host was acquired (crash / OOM / killed). Lets the caller flip
   *  downstream state — e.g. tell the scan worker pf is offline so its
   *  profile string stops claiming ML coverage. The host has already
   *  transitioned its own state to `failed` by the time this fires. */
  onCrash?: () => void
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
    // 90 s default for pf:ready — cold WASM model load can take close
    // to a minute; this gives headroom without inviting indefinite hang.
    const readyTimeoutMs = deps.readyTimeoutMs ?? 90_000
    const analyzeTimeoutMs = deps.analyzeTimeoutMs ?? 30_000
    const stateRef = yield* Ref.make<PfState>({ status: 'loading', runtime: null })
    const pending = new Map<number, {
      resolve: (matches: PfMatchResult[]) => void
      reject: (err: ModelHostError) => void
      timer: ReturnType<typeof setTimeout>
    }>()
    let nextReqId = 1

    const failWith = (err: unknown) =>
      Ref.set(stateRef, {
        status: 'failed',
        runtime: null,
        error: err instanceof ModelHostError ? String(err.cause) : String(err),
      })

    // Reject every pending analyze so callers stop waiting on a
    // response that's never coming once the renderer is gone.
    const rejectAllPending = (cause: string) => {
      for (const p of pending.values()) {
        clearTimeout(p.timer)
        p.reject(new ModelHostError({ stage: 'analyze', cause }))
      }
      pending.clear()
    }

    const win = yield* Effect.acquireRelease(
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
          yield* Ref.set(stateRef, {
            status: 'ready',
            runtime: handshake.runtime,
            detectionMs: handshake.detectionMs,
            ...(handshake.adapterLabel !== undefined ? { adapterLabel: handshake.adapterLabel } : {}),
          })
        } else if (handshake?.kind === 'failed') {
          yield* Ref.set(stateRef, { status: 'failed', runtime: null, error: handshake.message })
        }
        return w
      }),
      (w) =>
        Effect.sync(() => {
          for (const p of pending.values()) {
            clearTimeout(p.timer)
            p.reject(new ModelHostError({ stage: 'shutdown', cause: 'window closed' }))
          }
          pending.clear()
          if (w && !w.isDestroyed()) w.destroy()
        }),
    )

    // Watch for a post-acquire renderer crash. The handshake may have
    // already succeeded (state === 'ready'), so without this the host
    // keeps reporting `ready` after the inference window is gone:
    // `analyze` then fails the `win.isDestroyed()` guard and returns
    // [], scans silently downgrade to regex-only, and the scan
    // worker's profile string keeps falsely claiming `pf@...` coverage.
    // Flip state to `failed` and let the caller take the host offline.
    if (win) {
      const wc = win.webContents
      const onRenderGone = () => {
        rejectAllPending('render process gone')
        void Effect.runPromise(failWith(new ModelHostError({ stage: 'analyze', cause: 'render process gone' })))
        deps.onCrash?.()
      }
      yield* Effect.acquireRelease(
        Effect.sync(() => { wc.on('render-process-gone', onRenderGone) }),
        () => Effect.sync(() => { wc.removeListener('render-process-gone', onRenderGone) }),
      )
    }

    // Route analyze results back to the resolver waiting on that reqId.
    // We have to install this listener even when handshake hasn't
    // succeeded yet — the result message may arrive before
    // `state.status === 'ready'` is observed by callers.
    const targetSenderId = win?.webContents.id
    const onAnalyzeResult = (event: IpcMainEvent, payload: PfAnalyzeResult) => {
      if (targetSenderId !== undefined && event.sender.id !== targetSenderId) return
      const slot = pending.get(payload.reqId)
      if (!slot) return
      pending.delete(payload.reqId)
      clearTimeout(slot.timer)
      if (payload.ok) {
        slot.resolve(payload.matches as PfMatchResult[])
      } else {
        slot.reject(new ModelHostError({ stage: 'analyze', cause: payload.message }))
      }
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => { ipc.on(PF_IPC.ANALYZE_RESULT, onAnalyzeResult) }),
      () => Effect.sync(() => { ipc.removeListener(PF_IPC.ANALYZE_RESULT, onAnalyzeResult) }),
    )

    function analyze(text: string): Effect.Effect<PfMatchResult[], ModelHostError> {
      return Effect.gen(function* () {
        const state = yield* Ref.get(stateRef)
        if (state.status !== 'ready' || !win || win.isDestroyed()) {
          return yield* Effect.fail(new ModelHostError({ stage: 'analyze', cause: 'not ready' }))
        }
        const reqId = nextReqId++
        const result = yield* Effect.async<PfMatchResult[], ModelHostError>((resume) => {
          const timer = setTimeout(() => {
            pending.delete(reqId)
            resume(Effect.fail(new ModelHostError({
              stage: 'analyze',
              cause: `analyze timed out after ${analyzeTimeoutMs}ms`,
            })))
          }, analyzeTimeoutMs)
          pending.set(reqId, {
            resolve: (matches) => resume(Effect.succeed(matches)),
            reject: (err) => resume(Effect.fail(err)),
            timer,
          })
          try {
            win.webContents.send(PF_IPC.ANALYZE_REQUEST, { reqId, text } satisfies PfAnalyzeRequest)
          } catch (cause) {
            pending.delete(reqId)
            clearTimeout(timer)
            resume(Effect.fail(new ModelHostError({ stage: 'analyze', cause })))
          }
        })
        return result
      })
    }

    return {
      ready: Ref.get(stateRef).pipe(Effect.map((s) => s.status === 'ready')),
      getRuntime: Ref.get(stateRef).pipe(Effect.map((s) => s.runtime)),
      getState: Ref.get(stateRef),
      analyze,
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
        detectionMs: payload.detectionMs,
        ...(payload.adapterLabel !== undefined ? { adapterLabel: payload.adapterLabel } : {}),
      })
    }
    const onFailed = (event: IpcMainEvent, payload: PfFailedMessage) => {
      if (event.sender.id === targetId) settle({ kind: 'failed', message: payload.message })
    }
    const timer = setTimeout(
      () => settle({ kind: 'failed', message: `pf:ready handshake timed out after ${timeoutMs}ms` }),
      timeoutMs,
    )
    ipc.on(PF_IPC.READY, onReady)
    ipc.on(PF_IPC.FAILED, onFailed)
  })
}

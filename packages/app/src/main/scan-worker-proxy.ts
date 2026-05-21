// Main-process proxy that exposes the worker-thread scan engine as
// a regular ScanWorker. Renderers + IPC handlers don't need to know
// the engine actually lives in a child thread — the interface is
// identical to what `makeScanWorker` returns in-process, only the
// Effects shell out to postMessage round-trips instead of running
// SQL on the spot.
//
// See scan-worker-thread.ts for the worker side of the protocol.

import { Worker } from 'node:worker_threads'
import { Effect, PubSub, Stream } from 'effect'
import type { FindingsChange, ScanStatus, ScanWorker } from '@spool-lab/core'
import type { FromWorker, ScanCommand, ToWorker } from './scan-worker-thread.js'

export interface ScanWorkerProxy extends ScanWorker {
  /** Asks the worker thread to drain cleanly and waits for `exit`. */
  shutdown: () => Promise<void>
  /** Tells the worker the PF inference window is up so the pfProvider
   *  can start contributing findings. No-op when already online. */
  notifyPfOnline: () => void
  notifyPfOffline: () => void
}

export interface PfAnalyzeBridge {
  /** Run the inference round-trip for one chunk of text. Returning []
   *  is fine — the worker will treat it as "no PF matches". Errors get
   *  bubbled back to the worker as pf-analyze-res ok:false. */
  analyze: (text: string) => Promise<Array<{ class: string; value: string; start: number; end: number; score: number }>>
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

/** Spawn the worker thread at `workerPath` and return the proxy
 *  once it sends its first `ready` event. Throws if the child
 *  dies before ready. */
/** Boot timeout — guard against the worker_thread never reporting
 *  ready (e.g. a native-binding load failure that hangs the child
 *  rather than crashing it cleanly). 10s is comfortably above slow-
 *  disk Spotlight-indexing migrations on a fresh install. */
const BOOT_TIMEOUT_MS = 10_000

export async function spawnScanWorker(
  workerPath: string,
  pfBridge?: PfAnalyzeBridge,
): Promise<ScanWorkerProxy> {
  const worker = new Worker(workerPath)
  const pending = new Map<number, PendingCommand>()
  let nextReqId = 1
  let seenFirstStatus = false
  let lastStatus: ScanStatus = {
    queued: 0,
    scanning: null,
    backfillRemaining: 0,
    backfillTotal: 0,
    manualBurstInFlight: false,
    currentProfile: '',
  }

  // PubSubs live in main; they replay every event from the child
  // into the existing IPC forwarders (registerSecurityIpc subscribes
  // to `worker.changes` / `worker.statusChanges` via Stream.fromPubSub).
  const changes = await Effect.runPromise(PubSub.unbounded<FindingsChange>())
  const statusChanges = await Effect.runPromise(PubSub.unbounded<ScanStatus>())

  // postMessage throws synchronously when the worker's MessagePort has
  // closed. Swallow it — caller is post-shutdown territory.
  function postSafe(msg: ToWorker): void {
    try { worker.postMessage(msg) } catch { /* worker gone */ }
  }

  function send<T>(payload: ScanCommand): Promise<T> {
    const reqId = nextReqId++
    return new Promise<T>((resolve, reject) => {
      pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject })
      try {
        worker.postMessage({ type: 'cmd', reqId, payload } satisfies ToWorker)
      } catch (err) {
        // worker.postMessage throws synchronously if the MessagePort
        // is closed (e.g. the thread has already exited). Without
        // this catch the Promise would hang forever — onExit's
        // pending-rejection sweep only fires if the worker emits
        // the 'exit' event AFTER we registered it, which isn't the
        // case for a posthumous send.
        pending.delete(reqId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      // Best-effort terminate; if it's already dead this is a no-op.
      worker.terminate().catch(() => { /* nothing to do */ })
      reject(new Error(`scan worker did not report ready within ${BOOT_TIMEOUT_MS}ms`))
    }, BOOT_TIMEOUT_MS)
    function clear(): void {
      clearTimeout(timeout)
      worker.off('message', onMessage)
      worker.off('error', onError)
    }
    function onMessage(msg: FromWorker): void {
      if (msg.type === 'ready') {
        clear()
        worker.on('message', onSteadyState)
        worker.on('error', onSteadyError)
        worker.on('exit', onExit)
        resolve()
        return
      }
      if (msg.type === 'fatal') {
        clear()
        reject(new Error(`scan worker failed during boot: ${msg.error}`))
      }
      // Any other message type before ready is ignored — the worker
      // sends ready first, so this branch only fires for protocol
      // drift that should be caught in code review, not at runtime.
    }
    function onError(err: Error): void {
      clear()
      reject(err)
    }
    worker.on('message', onMessage)
    worker.on('error', onError)
  })

  function onSteadyState(msg: FromWorker): void {
    switch (msg.type) {
      case 'cmd-result': {
        const slot = pending.get(msg.reqId)
        if (slot) {
          pending.delete(msg.reqId)
          slot.resolve(msg.result)
        }
        return
      }
      case 'cmd-error': {
        const slot = pending.get(msg.reqId)
        if (slot) {
          pending.delete(msg.reqId)
          slot.reject(new Error(msg.error))
        }
        return
      }
      case 'event-change':
        Effect.runFork(PubSub.publish(changes, msg.change))
        return
      case 'event-status':
        lastStatus = msg.status
        seenFirstStatus = true
        Effect.runFork(PubSub.publish(statusChanges, msg.status))
        return
      case 'pf-analyze-req': {
        const { reqId, text } = msg
        // No bridge wired (e.g. PF runtime not booted) → answer
        // immediately with empty matches so the worker unblocks.
        if (!pfBridge) {
          postSafe({ type: 'pf-analyze-res', reqId, ok: true, matches: [] })
          return
        }
        pfBridge.analyze(text)
          .then((matches) => postSafe({ type: 'pf-analyze-res', reqId, ok: true, matches }))
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err)
            postSafe({ type: 'pf-analyze-res', reqId, ok: false, message })
          })
        return
      }
      case 'fatal':
        // Surfaces in console; pending commands fail via 'exit' below.
        console.error('[security] scan worker thread fatal:', msg.error)
        return
    }
  }

  function onSteadyError(err: Error): void {
    console.error('[security] scan worker thread error:', err)
  }

  function onExit(code: number): void {
    // Reject anything still in flight so renderer IPC handlers don't
    // hang forever on a dead worker.
    const err = new Error(`scan worker thread exited (code=${code})`)
    for (const slot of pending.values()) slot.reject(err)
    pending.clear()
  }

  return {
    enqueue: (sessionId) => Effect.promise(() => send<void>({ cmd: 'enqueue', sessionId })),
    rescanAll: () => Effect.promise(() => send<number>({ cmd: 'rescanAll' })),
    backfill: () => Effect.promise(() => send<number>({ cmd: 'backfill' })),
    // getStatus uses the last pushed status when available — saves a
    // round-trip on every renderer mount. Falls back to a real call
    // before the first push lands (boolean sentinel because an empty
    // profile string is a valid future value).
    getStatus: Effect.suspend(() =>
      seenFirstStatus
        ? Effect.succeed(lastStatus)
        : Effect.promise(() => send<ScanStatus>({ cmd: 'getStatus' })),
    ),
    changes: Stream.fromPubSub(changes),
    statusChanges: Stream.fromPubSub(statusChanges),
    shutdown: () =>
      new Promise<void>((resolve) => {
        worker.once('exit', () => resolve())
        try {
          worker.postMessage({ type: 'shutdown' } satisfies ToWorker)
        } catch {
          // postMessage throws on a closed port — the thread is
          // already gone, so satisfy the shutdown contract by
          // resolving immediately. Without this the exit listener
          // would never fire and the parent's `before-quit` handler
          // could stall the app shutdown.
          resolve()
        }
      }),
    notifyPfOnline: () => postSafe({ type: 'pf-online' }),
    notifyPfOffline: () => postSafe({ type: 'pf-offline' }),
  }
}

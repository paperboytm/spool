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
}

interface PendingCommand {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}

/** Spawn the worker thread at `workerPath` and return the proxy
 *  once it sends its first `ready` event. Throws if the child
 *  dies before ready. */
export async function spawnScanWorker(workerPath: string): Promise<ScanWorkerProxy> {
  const worker = new Worker(workerPath)
  const pending = new Map<number, PendingCommand>()
  let nextReqId = 1
  let lastStatus: ScanStatus = {
    queued: 0,
    scanning: null,
    backfillRemaining: 0,
    currentProfile: '',
  }

  // PubSubs live in main; they replay every event from the child
  // into the existing IPC forwarders (registerSecurityIpc subscribes
  // to `worker.changes` / `worker.statusChanges` via Stream.fromPubSub).
  const changes = await Effect.runPromise(PubSub.unbounded<FindingsChange>())
  const statusChanges = await Effect.runPromise(PubSub.unbounded<ScanStatus>())

  function send<T>(payload: ScanCommand): Promise<T> {
    const reqId = nextReqId++
    return new Promise<T>((resolve, reject) => {
      pending.set(reqId, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ type: 'cmd', reqId, payload } satisfies ToWorker)
    })
  }

  await new Promise<void>((resolve, reject) => {
    function onMessage(msg: FromWorker): void {
      if (msg.type === 'ready') {
        worker.off('message', onMessage)
        worker.off('error', onError)
        worker.on('message', onSteadyState)
        worker.on('error', onSteadyError)
        worker.on('exit', onExit)
        resolve()
        return
      }
      if (msg.type === 'fatal') {
        worker.off('message', onMessage)
        worker.off('error', onError)
        reject(new Error(`scan worker failed during boot: ${msg.error}`))
      }
    }
    function onError(err: Error): void {
      worker.off('message', onMessage)
      worker.off('error', onError)
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
        Effect.runFork(PubSub.publish(statusChanges, msg.status))
        return
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
    // before the first push lands.
    getStatus: Effect.suspend(() =>
      lastStatus.currentProfile === ''
        ? Effect.promise(() => send<ScanStatus>({ cmd: 'getStatus' }))
        : Effect.succeed(lastStatus),
    ),
    changes: Stream.fromPubSub(changes),
    statusChanges: Stream.fromPubSub(statusChanges),
    shutdown: () =>
      new Promise<void>((resolve) => {
        worker.once('exit', () => resolve())
        worker.postMessage({ type: 'shutdown' } satisfies ToWorker)
      }),
  }
}

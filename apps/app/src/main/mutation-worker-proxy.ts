// Main-process proxy that exposes the security mutation worker as a
// regular set of async functions. IPC handlers in ipc/security.ts
// don't need to know the SQL actually runs in a child thread — they
// call `proxy.purgeFindings(ids)` and get back a promise. Each command
// is round-tripped over postMessage; the per-event `FindingsChange`
// stream is forwarded straight onto a PubSub the existing
// registerSecurityIpc forwarder already subscribes to.
//
// See mutation-worker-thread.ts for the worker side of the protocol.

import { Worker } from 'node:worker_threads'
import { PubSub, Effect, Stream } from 'effect'
import type { FindingsChange, PurgeResult } from '@spool-lab/core'
import type { SensitiveKind } from '@spool-lab/redact'
import type {
  FromWorker,
  MutationCommand,
  MutationResult,
  PurgeErrorWire,
  ToWorker,
} from './mutation-worker-thread.js'

export interface MutationWorkerProxy {
  purgeFinding: (findingId: number) => Promise<PurgeResult>
  purgeFindings: (findingIds: number[]) => Promise<PurgeResult[]>
  purgeEverywhere: (
    kind: SensitiveKind,
    valueHash: string,
  ) => Promise<{ results: PurgeResult[]; sessionIds: number[] }>
  dismissFinding: (findingId: number, scope: 'session' | 'global') => Promise<number | null>
  dismissFindings: (findingIds: number[], scope: 'session' | 'global') => Promise<number[]>
  undismissFinding: (findingId: number) => Promise<number | null>
  /** PubSub the change-event forwarder subscribes to — same shape as
   *  the scan worker's `worker.changes` stream so the existing
   *  registerSecurityIpc daemon fiber can fork-and-forget on both. */
  changes: Stream.Stream<FindingsChange>
  /** Asks the worker thread to drain cleanly and waits for `exit`. */
  shutdown: () => Promise<void>
}

interface PendingCommand {
  resolve: (value: MutationResult) => void
  reject: (err: Error) => void
}

/** Custom error type carrying the worker-flattened `PurgeError` shape
 *  so IPC handlers can branch on `err.reason` (the renderer's existing
 *  error UI). */
export class MutationWorkerError extends Error {
  public readonly reason: PurgeErrorWire['reason'] | 'unknown'
  public readonly findingId: number | undefined
  constructor(error: PurgeErrorWire | { reason: 'unknown'; message: string }) {
    super('message' in error && typeof error.message === 'string' ? error.message : `mutation worker error: ${error.reason}`)
    this.name = 'MutationWorkerError'
    this.reason = error.reason
    this.findingId = 'findingId' in error ? error.findingId : undefined
  }
}

const BOOT_TIMEOUT_MS = 10_000

export async function spawnMutationWorker(workerPath: string): Promise<MutationWorkerProxy> {
  const worker = new Worker(workerPath)
  const pending = new Map<number, PendingCommand>()
  let nextReqId = 1

  const changes = await Effect.runPromise(PubSub.unbounded<FindingsChange>())

  function postSafe(msg: ToWorker): void {
    try { worker.postMessage(msg) } catch { /* worker gone */ }
  }

  function send(payload: MutationCommand): Promise<MutationResult> {
    const reqId = nextReqId++
    return new Promise<MutationResult>((resolve, reject) => {
      pending.set(reqId, { resolve, reject })
      try {
        worker.postMessage({ type: 'cmd', reqId, payload } satisfies ToWorker)
      } catch (err) {
        pending.delete(reqId)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  // Boot handshake — wait for `ready` before resolving. Mirrors the
  // scan-worker-proxy contract.
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.terminate().catch(() => { /* nothing to do */ })
      reject(new Error(`mutation worker did not report ready within ${BOOT_TIMEOUT_MS}ms`))
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
        reject(new Error(`mutation worker failed during boot: ${msg.error}`))
      }
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
        const p = pending.get(msg.reqId)
        if (p) {
          pending.delete(msg.reqId)
          p.resolve(msg.result)
        }
        return
      }
      case 'event-change': {
        void Effect.runPromise(PubSub.publish(changes, msg.change)).catch((err) => {
          console.error('[security] mutation worker change publish failed:', err)
        })
        return
      }
      case 'fatal':
        console.error('[security] mutation worker reported fatal:', msg.error)
        return
      default:
        return
    }
  }
  function onSteadyError(err: Error): void {
    console.error('[security] mutation worker emitted error event:', err)
  }
  function onExit(code: number): void {
    // Sweep any in-flight requests; without this, the IPC handlers
    // that awaited them would hang forever and the renderer would
    // see "loading" indefinitely.
    const err = new Error(`mutation worker exited with code ${code}`)
    for (const p of pending.values()) p.reject(err)
    pending.clear()
  }

  function unwrap(result: MutationResult): MutationResult & { ok: true } {
    if (!result.ok) throw new MutationWorkerError(result.error)
    return result
  }

  return {
    purgeFinding: async (findingId) => {
      const out = unwrap(await send({ cmd: 'purgeFinding', findingId }))
      if (out.cmd !== 'purgeFinding') throw new Error('mutation worker: cmd mismatch')
      return out.result
    },
    purgeFindings: async (findingIds) => {
      const out = unwrap(await send({ cmd: 'purgeFindings', findingIds }))
      if (out.cmd !== 'purgeFindings') throw new Error('mutation worker: cmd mismatch')
      return out.results
    },
    purgeEverywhere: async (kind, valueHash) => {
      const out = unwrap(await send({ cmd: 'purgeEverywhere', kind, valueHash }))
      if (out.cmd !== 'purgeEverywhere') throw new Error('mutation worker: cmd mismatch')
      return { results: out.results, sessionIds: out.sessionIds }
    },
    dismissFinding: async (findingId, scope) => {
      const out = unwrap(await send({ cmd: 'dismissFinding', findingId, scope }))
      if (out.cmd !== 'dismissFinding') throw new Error('mutation worker: cmd mismatch')
      return out.sessionId
    },
    dismissFindings: async (findingIds, scope) => {
      const out = unwrap(await send({ cmd: 'dismissFindings', findingIds, scope }))
      if (out.cmd !== 'dismissFindings') throw new Error('mutation worker: cmd mismatch')
      return out.sessionIds
    },
    undismissFinding: async (findingId) => {
      const out = unwrap(await send({ cmd: 'undismissFinding', findingId }))
      if (out.cmd !== 'undismissFinding') throw new Error('mutation worker: cmd mismatch')
      return out.sessionId
    },
    changes: Stream.fromPubSub(changes),
    shutdown: async () => {
      postSafe({ type: 'shutdown' })
      await new Promise<void>((resolve) => {
        worker.once('exit', () => resolve())
        setTimeout(() => {
          worker.terminate().catch(() => { /* nothing to do */ })
          resolve()
        }, 3000)
      })
    },
  }
}

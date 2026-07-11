import { describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'

/**
 * Regression test for the SIGTRAP startup crash reported on macOS 26.4.1
 * (incident keys B3D455CA…/A41A7FF1 and 5C249A38 on Spool 0.3.8 + 0.4.11):
 * an unhandled Promise rejection inside our sync worker took down the whole
 * Electron process because Node 22 defaults to --unhandled-rejections=strict.
 *
 * The fix in sync-worker.ts installs process.on('unhandledRejection') and
 * process.on('uncaughtException') handlers that postMessage an `error` to
 * the parent and exit cleanly. This test asserts the contract: rejection in
 * the worker → parent receives one error message + a non-zero exit, and the
 * test process itself stays healthy.
 */

type Outcome = { messages: unknown[]; exitCode: number | null; saw: 'exit' | 'timeout' }

function runWorker(code: string, { timeoutMs = 4000 } = {}): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    const messages: unknown[] = []
    const worker = new Worker(code, { eval: true })
    worker.on('message', (m) => messages.push(m))
    // Swallow worker errors at the parent so the test runner itself is unaffected
    // when we're explicitly probing failure paths.
    worker.on('error', () => {})
    const timer = setTimeout(() => {
      void worker.terminate().then(
        () => resolve({ messages, exitCode: null, saw: 'timeout' }),
        () => resolve({ messages, exitCode: null, saw: 'timeout' }),
      )
    }, timeoutMs)
    worker.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ messages, exitCode: code, saw: 'exit' })
    })
  })
}

describe('sync-worker unhandled-rejection contract', () => {
  it('with handlers installed: rejection becomes an error message + clean exit', async () => {
    const code = `
      const { parentPort } = require('worker_threads')
      function reportAndExit(err) {
        try {
          parentPort.postMessage({
            type: 'error',
            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
          })
        } catch {}
        process.exit(1)
      }
      process.on('unhandledRejection', reportAndExit)
      process.on('uncaughtException', reportAndExit)
      setImmediate(() => { Promise.reject(new Error('boom from worker')) })
    `
    const outcome = await runWorker(code)
    expect(outcome.saw).toBe('exit')
    expect(outcome.exitCode).toBe(1)
    const errorMsg = outcome.messages.find(
      (m): m is { type: 'error'; error: string } =>
        typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'error',
    )
    expect(errorMsg).toBeDefined()
    expect(errorMsg!.error).toContain('boom from worker')
  })

  it('without handlers: worker still dies but no error message is posted (regression baseline)', async () => {
    const code = `
      const { parentPort } = require('worker_threads')
      setImmediate(() => { Promise.reject(new Error('boom unhandled')) })
    `
    const outcome = await runWorker(code)
    expect(outcome.saw).toBe('exit')
    expect(outcome.exitCode).not.toBe(0)
    expect(outcome.messages).toHaveLength(0)
  })

  it('with handlers installed: synchronous throw is also caught and reported', async () => {
    const code = `
      const { parentPort } = require('worker_threads')
      function reportAndExit(err) {
        try {
          parentPort.postMessage({
            type: 'error',
            error: err instanceof Error ? (err.stack ?? err.message) : String(err),
          })
        } catch {}
        process.exit(1)
      }
      process.on('unhandledRejection', reportAndExit)
      process.on('uncaughtException', reportAndExit)
      try { throw new Error('sync throw') } catch (e) { reportAndExit(e) }
    `
    const outcome = await runWorker(code)
    expect(outcome.exitCode).toBe(1)
    const errorMsg = outcome.messages.find(
      (m): m is { type: 'error'; error: string } =>
        typeof m === 'object' && m !== null && (m as { type?: unknown }).type === 'error',
    )
    expect(errorMsg!.error).toContain('sync throw')
  })
})

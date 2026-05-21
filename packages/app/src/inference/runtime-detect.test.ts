import { describe, it, expect, vi } from 'vitest'
import { detectRuntime } from './runtime-detect.js'

const fakeGpu = (adapter: unknown) =>
  ({ requestAdapter: () => Promise.resolve(adapter as never) }) as const

describe('detectRuntime', () => {
  it('falls back to wasm when navigator.gpu is missing', async () => {
    const res = await detectRuntime({ gpu: null })
    expect(res.runtime).toBe('wasm')
  })

  it('returns webgpu when an adapter is granted', async () => {
    const res = await detectRuntime({ gpu: fakeGpu({ info: { description: 'Apple M2' } }) })
    expect(res.runtime).toBe('webgpu')
    expect(res.adapterLabel).toBe('Apple M2')
  })

  it('falls back to wasm when the adapter request resolves to null', async () => {
    const res = await detectRuntime({ gpu: fakeGpu(null) })
    expect(res.runtime).toBe('wasm')
  })

  it('falls back to wasm when requestAdapter throws', async () => {
    const gpu = { requestAdapter: () => Promise.reject(new Error('boom')) }
    const res = await detectRuntime({ gpu })
    expect(res.runtime).toBe('wasm')
  })

  it('falls back to wasm when the adapter request times out', async () => {
    vi.useFakeTimers()
    const gpu = { requestAdapter: () => new Promise<never>(() => { /* never */ }) }
    const p = detectRuntime({ gpu, timeoutMs: 50 })
    await vi.advanceTimersByTimeAsync(60)
    const res = await p
    expect(res.runtime).toBe('wasm')
    vi.useRealTimers()
  })
})

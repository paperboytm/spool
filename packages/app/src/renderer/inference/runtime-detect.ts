// WebGPU / WASM runtime detection for the hidden inference renderer.
//
// Feature-detecting `navigator.gpu` isn't enough — some Chromium builds
// expose the API but `requestAdapter()` still returns null (e.g. headless
// without ANGLE), so we have to attempt the call. The 2 s timeout exists
// because on macOS the adapter request usually returns in tens of ms;
// anything longer means the call is wedged and we'd rather fall back to
// WASM than block the inference window's boot indefinitely.

import type { PfRuntime } from './types.js'

interface GpuAdapter {
  info?: { description?: string; vendor?: string; device?: string }
}
interface GpuLike {
  requestAdapter(): Promise<GpuAdapter | null>
}

export interface DetectResult {
  runtime: PfRuntime
  adapterLabel?: string
}

export interface DetectOptions {
  timeoutMs?: number
  /** Injected for tests. Default reads `navigator.gpu`. */
  gpu?: GpuLike | null
}

function defaultGpu(): GpuLike | null {
  if (typeof navigator === 'undefined') return null
  return (navigator as Navigator & { gpu?: GpuLike }).gpu ?? null
}

export async function detectRuntime(opts: DetectOptions = {}): Promise<DetectResult> {
  const timeoutMs = opts.timeoutMs ?? 2_000
  const gpu = opts.gpu ?? defaultGpu()
  if (!gpu) return { runtime: 'wasm' }

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })

  try {
    const adapter = await Promise.race([gpu.requestAdapter(), timeoutP])
    if (!adapter) return { runtime: 'wasm' }
    const label = adapterLabelOf(adapter)
    return label ? { runtime: 'webgpu', adapterLabel: label } : { runtime: 'webgpu' }
  } catch {
    return { runtime: 'wasm' }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function adapterLabelOf(adapter: GpuAdapter): string | undefined {
  // `info` is sync on recent Chromium, behind `requestAdapterInfo()` on
  // older builds. We don't await the async path — the label is decorative.
  const info = adapter.info
  if (!info) return undefined
  const desc = info.description ?? info.vendor ?? info.device
  return typeof desc === 'string' && desc.length > 0 ? desc : undefined
}

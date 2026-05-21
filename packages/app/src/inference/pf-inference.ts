// Hidden inference renderer entry. Loads in a BrowserWindow created by
// `model-host.ts`, performs the WebGPU/WASM runtime probe, and hands
// the result back to main via the `pf:ready` IPC channel.
//
// PR 5a scope: handshake only. transformers.js + ONNX model loading
// lands in PR 5c.

import { detectRuntime } from './runtime-detect.js'
import type { PfReadyMessage, PfFailedMessage } from './types.js'

declare global {
  interface Window {
    /** Provided by `inference-preload.ts` (exposed via contextBridge). */
    pfBridge?: {
      ready: (payload: PfReadyMessage) => void
      failed: (payload: PfFailedMessage) => void
    }
  }
}

async function main(): Promise<void> {
  const bridge = window.pfBridge
  if (!bridge) {
    // No preload means contextBridge isn't wired. We can't reach main
    // without IPC; surface to devtools for engineers running with
    // `openDevTools()`.
    console.error('[pf-inference] pfBridge missing — preload not wired')
    return
  }
  const t0 = performance.now()
  try {
    const res = await detectRuntime()
    const detectionMs = Math.round(performance.now() - t0)
    bridge.ready({
      runtime: res.runtime,
      detectionMs,
      ...(res.adapterLabel !== undefined ? { adapterLabel: res.adapterLabel } : {}),
    })
  } catch (err) {
    bridge.failed({ message: err instanceof Error ? err.message : String(err) })
  }
}

void main()

// Hidden inference renderer entry. Loads in a BrowserWindow created
// by `model-host.ts`, performs the WebGPU/WASM runtime probe, and
// answers `pf:analyze-request` IPCs. The analyze handler currently
// returns []; real ONNX inference lands in a follow-up PR.

import { detectRuntime } from './runtime-detect.js'
import type { PfAnalyzeRequest, PfAnalyzeResult, PfReadyMessage, PfFailedMessage } from './types.js'

declare global {
  interface Window {
    pfBridge?: {
      ready: (payload: PfReadyMessage) => void
      failed: (payload: PfFailedMessage) => void
      onAnalyzeRequest: (handler: (req: PfAnalyzeRequest) => void) => () => void
      sendAnalyzeResult: (payload: PfAnalyzeResult) => void
    }
  }
}

async function main(): Promise<void> {
  const bridge = window.pfBridge
  if (!bridge) {
    console.error('[pf-inference] pfBridge missing — preload not wired')
    return
  }

  // Stub: round-trip the request with an empty match list. Real ONNX
  // inference replaces this body in a follow-up PR.
  bridge.onAnalyzeRequest((req) => {
    bridge.sendAnalyzeResult({ reqId: req.reqId, ok: true, matches: [] })
  })

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

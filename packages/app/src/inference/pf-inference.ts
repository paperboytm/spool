// Hidden inference renderer entry. Loads transformers.js, runs the
// Privacy Filter token-classification pipeline, and answers
// `pf:analyze-request` IPCs from main.
//
// The pf:ready handshake only fires AFTER the model has finished
// loading — ModelHost's readyTimeoutMs is sized accordingly. That
// way the scan worker doesn't pay 10-30 s of model warmup on its
// very first analyze call.

import { detectRuntime } from './runtime-detect.js'
import type {
  PfAnalyzeRequest, PfAnalyzeResult, PfReadyMessage, PfFailedMessage, PfMatch,
} from './types.js'

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

/** Directory name under userData/models/ — must match PF_MODEL_ID in
 *  model-paths.ts. transformers.js fetches files at
 *  `pf-model:///${PF_MODEL_ID}/{file}`. */
const PF_MODEL_ID = 'openai-privacy-filter-q4'

interface PipelineOutput {
  entity_group: string
  score: number
  word: string
  start: number
  end: number
}

type Pipeline = (text: string, opts?: { aggregation_strategy?: string }) => Promise<PipelineOutput[]>

async function main(): Promise<void> {
  const bridge = window.pfBridge
  if (!bridge) {
    console.error('[pf-inference] pfBridge missing — preload not wired')
    return
  }

  const t0 = performance.now()
  let runtime: 'webgpu' | 'wasm'
  let adapterLabel: string | undefined
  try {
    const detect = await detectRuntime()
    runtime = detect.runtime
    adapterLabel = detect.adapterLabel
  } catch (err) {
    bridge.failed({ message: `runtime detection failed: ${err instanceof Error ? err.message : String(err)}` })
    return
  }

  let pipe: Pipeline
  try {
    const tx = await import('@huggingface/transformers')
    // Pin transformers.js to pf-model:// so it never reaches the
    // network. allowRemoteModels=false guards against accidental
    // CDN fetches if a code path forgets to pass localModelPath.
    tx.env.allowLocalModels = true
    tx.env.allowRemoteModels = false
    tx.env.localModelPath = 'pf-model:///'
    tx.env.useBrowserCache = false
    const built = await tx.pipeline('token-classification', PF_MODEL_ID, {
      device: runtime === 'webgpu' ? 'webgpu' : 'wasm',
      dtype: 'q4',
    })
    pipe = built as unknown as Pipeline
  } catch (err) {
    bridge.failed({ message: `model load failed: ${err instanceof Error ? err.message : String(err)}` })
    return
  }

  bridge.onAnalyzeRequest((req) => {
    void analyzeOne(req, pipe, bridge)
  })

  const detectionMs = Math.round(performance.now() - t0)
  bridge.ready({
    runtime,
    detectionMs,
    ...(adapterLabel !== undefined ? { adapterLabel } : {}),
  })
}

async function analyzeOne(
  req: PfAnalyzeRequest,
  pipe: Pipeline,
  bridge: NonNullable<Window['pfBridge']>,
): Promise<void> {
  try {
    const output = await pipe(req.text, { aggregation_strategy: 'simple' })
    const matches: PfMatch[] = output.map((m) => ({
      // openai/privacy-filter emits `private_person`, `private_email`,
      // etc. The class-mapping module operates on the short form so
      // the same code works for future models without the prefix.
      class: m.entity_group.toLowerCase().replace(/^private_/, ''),
      value: m.word,
      start: m.start,
      end: m.end,
      score: m.score,
    }))
    bridge.sendAnalyzeResult({ reqId: req.reqId, ok: true, matches })
  } catch (err) {
    bridge.sendAnalyzeResult({
      reqId: req.reqId,
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    })
  }
}

void main()

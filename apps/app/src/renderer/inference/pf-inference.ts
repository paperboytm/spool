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
    // ORT Runtime Web defaults to fetching its WASM / JS runtime
    // from cdn.jsdelivr.net — incompatible with the offline guarantee
    // + blocked by our strict CSP. Point it at our protocol's `ort/`
    // subpath; main serves those files out of onnxruntime-web's dist.
    // The wasm field is loosely typed via `?` — guard the assignment.
    if (tx.env.backends.onnx.wasm) {
      tx.env.backends.onnx.wasm.wasmPaths = 'pf-model:///ort/'
    }
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
    // findings.start_offset + end_offset are NOT NULL in SQLite, so
    // a match without character anchors would roll back the entire
    // session's scan transaction (taking the regex findings down with
    // it). transformers.js with BPE tokenizers sometimes returns
    // start/end undefined even with aggregation_strategy='simple',
    // so:
    //   1) keep what the tokenizer gave us when it's there
    //   2) otherwise re-locate the word in the source via indexOf
    //   3) only drop if even indexOf comes up empty (rare — the word
    //      came FROM the tokenizer over the source, so finding it
    //      back should be almost universal)
    let searchCursor = 0
    const matches: PfMatch[] = output.flatMap((m) => {
      const cls = m.entity_group.toLowerCase().replace(/^private_/, '')
      let start = m.start
      let end = m.end
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        // Use a cursor so multiple instances of the same word land at
        // distinct offsets instead of all collapsing onto the first
        // occurrence. transformers.js returns matches in document
        // order, so the cursor advances monotonically.
        const idx = req.text.indexOf(m.word, searchCursor)
        if (idx < 0) return []  // word doesn't actually appear — drop
        start = idx
        end = idx + m.word.length
        searchCursor = end
      } else {
        // Advance cursor past native-offset matches too so a later
        // fallback doesn't go backwards in the text.
        searchCursor = Math.max(searchCursor, end as number)
      }
      return [{ class: cls, value: m.word, start: start as number, end: end as number, score: m.score }]
    })
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

// IPC payload shapes shared between main and the hidden `pf-inference`
// renderer. Channel names are literal constants so both bundles can
// import them for type-checking without a runtime dependency.

export type PfRuntime = 'webgpu' | 'wasm'

export interface PfReadyMessage {
  runtime: PfRuntime
  adapterLabel?: string
  detectionMs: number
}

export type PfFailedMessage = { message: string }

export interface PfAnalyzeRequest {
  reqId: number
  text: string
}

export interface PfMatch {
  class: string
  value: string
  start: number
  end: number
  score: number
}

export interface PfAnalyzeResponse {
  reqId: number
  ok: true
  matches: PfMatch[]
}

export interface PfAnalyzeError {
  reqId: number
  ok: false
  message: string
}

export type PfAnalyzeResult = PfAnalyzeResponse | PfAnalyzeError

export const PF_IPC = {
  READY: 'pf:ready',
  FAILED: 'pf:failed',
  /** main → inference: analyse this text. */
  ANALYZE_REQUEST: 'pf:analyze-request',
  /** inference → main: result for a previous request, keyed by reqId. */
  ANALYZE_RESULT: 'pf:analyze-result',
} as const

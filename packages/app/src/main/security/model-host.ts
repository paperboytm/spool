// ModelHost — Effect Scoped Resource that owns the hidden Browser-
// Window running the Privacy Filter inference renderer.
//
// WebGPU is a renderer-only API in Chromium, so the main process
// can't run it directly. The hidden BrowserWindow loads
// `pf-inference.html`, detects WebGPU (with WASM fallback), and
// answers IPC requests.
//
// This file is intentionally a scaffold: the BrowserWindow + IPC
// machinery is wired, but the actual `analyze` call returns an
// empty match list until a follow-up PR ships the real
// transformers.js + ONNX runtime and the pinned model bundle. The
// Settings UI surfaces this honestly as "Coming soon".

import { Effect, Ref, Data } from 'effect'
import type { BrowserWindow } from 'electron'

export type PfRuntime = 'webgpu' | 'wasm' | 'unsupported'

export interface PfState {
  status: 'idle' | 'loading' | 'ready' | 'failed' | 'not-downloaded'
  runtime: PfRuntime | null
  error?: string
}

export class ModelHostError extends Data.TaggedError('ModelHostError')<{
  readonly stage: 'spawn' | 'load' | 'analyze' | 'shutdown'
  readonly cause: unknown
}> {}

export interface PfMatchResult {
  /** PF-class label, e.g. 'person', 'email'. */
  class: string
  value: string
  start: number
  end: number
  score: number
}

export interface ModelHost {
  /** True only when the hidden window is up and the model is loaded. */
  ready: Effect.Effect<boolean>
  /** Current renderer runtime once the window reports it. */
  getRuntime: Effect.Effect<PfRuntime | null>
  /** Current high-level state for Settings UI consumption. */
  getState: Effect.Effect<PfState>
  /** Analyse a chunk of text. Returns an empty array when the model
   *  isn't ready — callers should check `ready` first if they need
   *  to fail loudly. */
  analyze: (text: string) => Effect.Effect<PfMatchResult[], ModelHostError>
}

/** Build a ModelHost as a Scoped service. The scope owns the hidden
 *  BrowserWindow lifecycle: scope-acquired creates it; scope-closed
 *  destroys it, releasing GPU/CPU resources.
 *
 *  STUB: the real implementation creates a hidden BrowserWindow, loads
 *  `pf-inference.html`, waits for a `pf:ready` handshake, and routes
 *  `pf:analyze` IPC. That logic ships in a follow-up — this file
 *  defines the interface and the lifecycle plumbing so the Settings
 *  UI + scan worker can compile against a stable shape today.
 */
export function makeModelHost(): Effect.Effect<ModelHost, never, never> {
  return Effect.gen(function* () {
    const stateRef = yield* Ref.make<PfState>({ status: 'not-downloaded', runtime: null })
    const windowRef = yield* Ref.make<BrowserWindow | null>(null)
    void windowRef // reserved for the real implementation

    const host: ModelHost = {
      ready: Ref.get(stateRef).pipe(Effect.map((s) => s.status === 'ready')),
      getRuntime: Ref.get(stateRef).pipe(Effect.map((s) => s.runtime)),
      getState: Ref.get(stateRef),
      analyze: (_text: string) =>
        // Stub: until the inference window ships, return an empty
        // match list. The scan worker still runs the regex provider;
        // PF acts as additive signal once the bundle is installed.
        Effect.succeed<PfMatchResult[]>([]),
    }
    return host
  })
}

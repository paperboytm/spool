// IPC payload shapes shared between main and the hidden `pf-inference`
// renderer. The inference preload is a separate bundle and can't share
// runtime values with main, so the channel names live here as literal
// constants and both sides import the same module for type-checking.

export type PfRuntime = 'webgpu' | 'wasm'

export interface PfReadyMessage {
  runtime: PfRuntime
  adapterLabel?: string
  detectionMs: number
}

export type PfFailedMessage = { message: string }

export const PF_IPC = {
  READY: 'pf:ready',
  FAILED: 'pf:failed',
} as const

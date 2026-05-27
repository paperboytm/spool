// Decision for the callout-driven Privacy Filter auto-activation.
//
// When a user clicks "Enable" in the in-page PF callout, a (large) model
// download starts and `pfActivationPending` is set. The PF coordinator is
// a process-lifetime singleton, so the download keeps running even if the
// user disables the whole Security feature mid-download. When it finishes,
// the coordinator fires its 'installed' event — and we must NOT auto-spawn
// the hidden inference window if the feature was torn down in the
// meantime (that would resurrect a hidden process behind an OFF toggle).
//
// Pure + injected so the transient "disabled mid-download" case is unit-
// testable without the Electron/main shell.

export interface PfAutoActivateInput {
  /** Latest PF coordinator phase. */
  phase: string
  /** Whether the Security feature is currently booted (worker + IPC up).
   *  False once teardownSecurity has run. */
  securityBooted: boolean
  /** User asked to activate PF (set when they clicked Enable in the callout). */
  pfActivationPending: boolean
  /** PF is already on — nothing to auto-activate. */
  pfEnabled: boolean
}

/** True only when a just-installed model should auto-activate PF on the
 *  user's behalf: the feature is still on, activation was requested, and
 *  PF isn't already enabled. */
export function shouldAutoActivatePf(input: PfAutoActivateInput): boolean {
  return (
    input.phase === 'installed' &&
    input.securityBooted &&
    input.pfActivationPending &&
    !input.pfEnabled
  )
}

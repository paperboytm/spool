// Pure helpers that convert the worker thread's `Effect.Exit` results
// into the serialisable `PurgeErrorWire` shape the proxy + IPC layer
// consume. Extracted from `mutation-worker-thread.ts` so the (easy to
// get subtly wrong) Effect-Cause unwrap has its own unit-test surface:
// the previous shape used `Exit.causeOption(exit).value` directly,
// which returns a `Cause<E>` rather than the raw `E` — every typed
// `PurgeError` landed on the wire as `{ reason: 'unknown' }` and the
// renderer's reason-keyed error branches silently died. Catching that
// at test time is much cheaper than catching it at runtime.

import { Cause, Exit } from 'effect'

/** Serialisable mirror of `PurgeError` from @spool-lab/core. The core
 *  type is a tagged class; postMessage strips the prototype, so we
 *  flatten to plain fields and rebuild selectively on the proxy side
 *  when the IPC handler needs them. */
export interface PurgeErrorWire {
  reason: 'not-found' | 'already-purged' | 'message-missing' | 'db-failed'
  findingId: number
  message?: string
}

export type WireError = PurgeErrorWire | { reason: 'unknown'; message: string }

/** Unwrap an `Exit.Failure`'s `Cause<E>` down to the typed `E` (or
 *  `null` when the cause is a defect / interrupt rather than a
 *  business failure). Two hops:
 *
 *    1. `Exit.causeOption(exit)`     → Option<Cause<E>>
 *    2. `Cause.failureOption(cause)` → Option<E>
 *
 *  Skipping step 2 was the original bug. */
export function unwrapEffectFailure<A, E>(exit: Exit.Exit<A, E>): E | null {
  if (Exit.isSuccess(exit)) return null
  const causeOpt = Exit.causeOption(exit)
  if (causeOpt._tag !== 'Some') return null
  const failOpt = Cause.failureOption(causeOpt.value)
  return failOpt._tag === 'Some' ? failOpt.value : null
}

/** Duck-type a raw failure into the wire shape. Anything that
 *  doesn't structurally match a `PurgeError` (including `null`, plain
 *  `Error`, defects, interrupts) degrades to `{ reason: 'unknown' }`
 *  so the wire schema stays closed even when the Effect runtime hands
 *  us something exotic. */
export function flattenPurgeError(err: unknown): WireError {
  if (
    err && typeof err === 'object' && 'reason' in err && 'findingId' in err &&
    typeof (err as { reason: unknown }).reason === 'string' &&
    typeof (err as { findingId: unknown }).findingId === 'number'
  ) {
    const e = err as { reason: PurgeErrorWire['reason']; findingId: number; cause?: unknown }
    return {
      reason: e.reason,
      findingId: e.findingId,
      ...(e.cause instanceof Error ? { message: e.cause.message } : {}),
    }
  }
  return { reason: 'unknown', message: err instanceof Error ? err.message : String(err) }
}

/** One-shot Exit → wire helper. `onSuccess` shapes the per-command
 *  success result so each command can stay strongly typed without
 *  duplicating the (Exit.isSuccess → Exit.causeOption → Cause.failureOption)
 *  walk in every case. */
export function exitToWireResult<A, E, S>(
  exit: Exit.Exit<A, E>,
  onSuccess: (value: A) => S,
): { ok: true; success: S } | { ok: false; error: WireError } {
  if (Exit.isSuccess(exit)) return { ok: true, success: onSuccess(exit.value) }
  return { ok: false, error: flattenPurgeError(unwrapEffectFailure(exit)) }
}

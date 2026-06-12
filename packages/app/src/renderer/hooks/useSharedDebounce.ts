// A single trailing-debounce window shared by several tasks.
//
// The share editor runs two heavy follow-ups after every edit — the
// draft autosave and the publish drift check — each debounced at
// 400ms. As two independent timers they fire back-to-back at t+400ms,
// stacking two full document builds in the same breath on the main
// thread, and tuning the window means keeping two constants in sync.
// This gives them ONE window: scheduling any task (re)arms the shared
// timer, and when it fires every pending task runs once.
//
// Semantics per task key match a plain trailing debounce: scheduling
// the same key again replaces the pending callback, so only the latest
// closure runs. Disposal cancels the window without running anything —
// callers that must flush on unmount (autosave does) keep their own
// unmount flush, which reads from refs and doesn't depend on this
// timer.

import { useEffect, useMemo } from 'react'

export interface SharedDebounce {
  /** Schedule `task` under `key`, (re)arming the shared window. A task
   *  scheduled again before the window fires replaces the previous
   *  callback for that key. */
  schedule: (key: string, task: () => void) => void
  /** Drop a pending task without running it (e.g. when the effect that
   *  scheduled it re-runs and will schedule a replacement — or not). */
  cancel: (key: string) => void
  /** Cancel the window and every pending task. */
  dispose: () => void
}

interface TimerHost {
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (handle: number) => void
}

/** Pure factory — timers injectable so the merge/replace/dispose
 *  semantics are unit-testable without a DOM or fake global clock. */
export function createSharedDebounce(delayMs: number, host: TimerHost): SharedDebounce {
  let handle: number | null = null
  const tasks = new Map<string, () => void>()

  const schedule = (key: string, task: () => void) => {
    tasks.set(key, task)
    if (handle !== null) host.clearTimeout(handle)
    handle = host.setTimeout(() => {
      handle = null
      const pending = Array.from(tasks.values())
      tasks.clear()
      for (const t of pending) t()
    }, delayMs)
  }

  const cancel = (key: string) => {
    tasks.delete(key)
  }

  const dispose = () => {
    if (handle !== null) host.clearTimeout(handle)
    handle = null
    tasks.clear()
  }

  return { schedule, cancel, dispose }
}

export function useSharedDebounce(delayMs: number): SharedDebounce {
  const debounce = useMemo(
    () =>
      createSharedDebounce(delayMs, {
        setTimeout: (fn, ms) => window.setTimeout(fn, ms),
        clearTimeout: (h) => window.clearTimeout(h),
      }),
    [delayMs],
  )
  useEffect(() => () => debounce.dispose(), [debounce])
  return debounce
}

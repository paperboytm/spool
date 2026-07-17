import { useCallback, useRef, useState } from 'react'

type UpdaterFn<T> = (prev: T) => T
type SetArg<T> = T | UpdaterFn<T>

export interface UndoSnapshot<T> {
  past: T[]
  present: T
  future: T[]
}

interface NormalisedOptions {
  coalesceMs: number
  maxHistory: number
}

export interface UndoableOptions {
  /** Sets within this many ms of the previous one collapse onto the
   *  same undo entry — slider drags become one step instead of fifty.
   *  Default 500. */
  coalesceMs?: number
  /** Hard cap on the past stack so unbounded edit sessions don't grow
   *  the heap. Default 100. */
  maxHistory?: number
}

export interface UndoableState<T> {
  state: T
  set: (next: SetArg<T>) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** Discard history and start fresh. Use when the underlying record
   *  changes identity (e.g. user switches to a different draft) so the
   *  old undo stack doesn't carry across. */
  reset: (newInitial: T) => void
}

const DEFAULTS: NormalisedOptions = { coalesceMs: 500, maxHistory: 100 }

/** Pure transition for a `set`. Returns the new snapshot plus the new
 *  `lastSetAt` watermark so the caller can persist it across calls. */
export function applySet<T>(
  snap: UndoSnapshot<T>,
  next: T,
  lastSetAt: number,
  now: number,
  options: NormalisedOptions = DEFAULTS,
): { snap: UndoSnapshot<T>; lastSetAt: number } {
  if (Object.is(next, snap.present)) return { snap, lastSetAt }
  const shouldCoalesce = now - lastSetAt < options.coalesceMs
  if (shouldCoalesce) {
    return { snap: { ...snap, present: next }, lastSetAt: now }
  }
  const newPast = [...snap.past, snap.present]
  const trimmed = newPast.length > options.maxHistory
    ? newPast.slice(newPast.length - options.maxHistory)
    : newPast
  return { snap: { past: trimmed, present: next, future: [] }, lastSetAt: now }
}

export function applyUndo<T>(snap: UndoSnapshot<T>): UndoSnapshot<T> {
  if (snap.past.length === 0) return snap
  const previous = snap.past[snap.past.length - 1]!
  return {
    past: snap.past.slice(0, -1),
    present: previous,
    future: [...snap.future, snap.present],
  }
}

export function applyRedo<T>(snap: UndoSnapshot<T>): UndoSnapshot<T> {
  if (snap.future.length === 0) return snap
  const next = snap.future[snap.future.length - 1]!
  return {
    past: [...snap.past, snap.present],
    present: next,
    future: snap.future.slice(0, -1),
  }
}

export function useUndoableState<T>(
  initial: T,
  options: UndoableOptions = {},
): UndoableState<T> {
  const normalised: NormalisedOptions = {
    coalesceMs: options.coalesceMs ?? DEFAULTS.coalesceMs,
    maxHistory: options.maxHistory ?? DEFAULTS.maxHistory,
  }
  const [snapshot, setSnapshot] = useState<UndoSnapshot<T>>(() => ({
    past: [],
    present: initial,
    future: [],
  }))
  // Wall-clock of the most recent `set`. Reset to 0 after undo/redo/reset
  // so the next user edit always starts a fresh entry — we never want to
  // coalesce a user edit with a system-driven state replacement.
  const lastSetAtRef = useRef<number>(0)

  const set = useCallback((next: SetArg<T>) => {
    // Capture wall-clock + the watermark BEFORE entering the updater so
    // the ref mutation stays out of the setState reducer (StrictMode
    // double-invokes those, ref mutation there is an anti-pattern).
    const now = Date.now()
    const prevLastSetAt = lastSetAtRef.current
    lastSetAtRef.current = now
    setSnapshot(prev => {
      const resolved = typeof next === 'function'
        ? (next as UpdaterFn<T>)(prev.present)
        : next
      return applySet(prev, resolved, prevLastSetAt, now, normalised).snap
    })
    // `normalised` is rebuilt each render but its primitives are stable;
    // depending on the inner numbers (rather than the wrapper object)
    // keeps `set`'s identity stable for downstream consumers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalised.coalesceMs, normalised.maxHistory])

  const undo = useCallback(() => {
    setSnapshot(applyUndo)
    lastSetAtRef.current = 0
  }, [])

  const redo = useCallback(() => {
    setSnapshot(applyRedo)
    lastSetAtRef.current = 0
  }, [])

  const reset = useCallback((newInitial: T) => {
    setSnapshot({ past: [], present: newInitial, future: [] })
    lastSetAtRef.current = 0
  }, [])

  return {
    state: snapshot.present,
    set,
    undo,
    redo,
    canUndo: snapshot.past.length > 0,
    canRedo: snapshot.future.length > 0,
    reset,
  }
}

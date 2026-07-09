// Progressive-mount chunking for large conversation documents. A
// published snapshot can carry up to the backend's 2MB cap — a few
// thousand turns — and rendering them all in one synchronous commit
// blocks the main thread for seconds, freezing first paint (especially
// on mobile). Mount a small initial slice cheaply, then grow one chunk
// per animation frame until the whole document is in.
//
// This is the single implementation shared by the public reader and
// the editor preview (packages/app/.../preview-progressive.ts wraps it
// with editor-tuned constants) — the fill semantics are load-bearing
// on both surfaces and must not drift.

import { useEffect, useState } from 'react'

/** First slice rendered on mount — kept small so first paint is cheap. */
export const READER_INITIAL_TURNS = 80

/** Turns appended per animation frame while filling the document. */
export const READER_TURNS_PER_FRAME = 400

/** Backstop cadence for filling while the tab is hidden — rAF is
 *  paused in background tabs, and browsers throttle hidden-tab timers
 *  to ~1/sec, so this fills a few hundred turns per second until the
 *  tab is shown (when rAF takes over at full rate). */
const HIDDEN_TAB_FILL_MS = 200

/** One growth step: pure so the chunking math is unit-testable. */
export function nextReaderCount(
  current: number,
  total: number,
  step: number = READER_TURNS_PER_FRAME,
): number {
  return Math.min(current + step, total)
}

/**
 * Progressive mount counter: start at `initial` turns, then grow one
 * chunk per animation frame until every turn is mounted.
 *
 * Completeness guarantees:
 * - No `requestAnimationFrame` (SSR / static prerender, where effects
 *   never run): the counter INITIALIZES to `total`, so the first —
 *   and only — render is the complete document.
 * - Hidden/background tab (rAF paused): a throttled timeout backstop
 *   keeps the fill progressing, so the document reaches completion
 *   even if the tab is printed or read without ever being focused.
 */
export function useProgressiveTurns(
  total: number,
  initial: number = READER_INITIAL_TURNS,
  step: number = READER_TURNS_PER_FRAME,
): number {
  const [count, setCount] = useState(() =>
    typeof requestAnimationFrame === 'function' ? Math.min(initial, total) : total,
  )
  useEffect(() => {
    // Clamp when the document shrinks (e.g. fewer turns after a draft
    // reload); never reset an already-filled view back to the first
    // chunk on unrelated conversation identity churn.
    setCount((c) => Math.min(c, total))
  }, [total])
  useEffect(() => {
    if (count >= total) return
    const advance = () => setCount((c) => nextReaderCount(c, total, step))
    const raf = requestAnimationFrame(advance)
    // Both schedulers race; the state change re-runs this effect and
    // the cleanup cancels the loser. If both fire before a re-render,
    // advance is monotonic-safe — the fill just moves two steps.
    const timer = setTimeout(advance, HIDDEN_TAB_FILL_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [count, total, step])
  return Math.min(count, total)
}

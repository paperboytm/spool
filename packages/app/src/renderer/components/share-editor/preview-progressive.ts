// Progressive-mount chunking for the share-editor preview. Pure logic
// + a small stateful hook, split out of PreviewPane so the math is
// unit-testable without dragging the template/markdown render chain
// (which needs a DOM) into the node test environment.

import { useEffect, useState } from 'react'

/** First progressive chunk. Must stay comfortably above the e2e
 *  fixtures' turn counts so small documents render whole on the first
 *  commit — progressive mounting only kicks in for genuinely large
 *  sessions. Guarded by PreviewPane.test.ts against fixture growth. */
export const PREVIEW_INITIAL_TURNS = 150

/** Turns appended per animation frame while filling the document. */
export const PREVIEW_TURNS_PER_FRAME = 600

/** One growth step: pure so the chunking math is unit-testable. */
export function nextProgressiveCount(
  current: number,
  total: number,
  step: number = PREVIEW_TURNS_PER_FRAME,
): number {
  return Math.min(current + step, total)
}

/**
 * Progressive mount counter: start at `initial` turns so the first
 * commit (and the fit-scale measurement behind it) is cheap, then
 * grow one chunk per animation frame until the whole document is in.
 * Rendering all turns synchronously blocks the main thread for
 * seconds on multi-thousand-turn sessions — the editor froze on open
 * and painted at fallback scale until the giant commit finished.
 */
export function useProgressiveCount(
  total: number,
  initial: number = PREVIEW_INITIAL_TURNS,
  step: number = PREVIEW_TURNS_PER_FRAME,
): number {
  const [count, setCount] = useState(() => Math.min(initial, total))
  useEffect(() => {
    // Clamp when the document shrinks (e.g. fewer turns after a draft
    // reload); never reset an already-filled view back to the first
    // chunk on unrelated conversation identity churn.
    setCount((c) => Math.min(c, total))
  }, [total])
  useEffect(() => {
    if (count >= total) return
    const raf = requestAnimationFrame(() => {
      setCount((c) => nextProgressiveCount(c, total, step))
    })
    return () => cancelAnimationFrame(raf)
  }, [count, total, step])
  return Math.min(count, total)
}

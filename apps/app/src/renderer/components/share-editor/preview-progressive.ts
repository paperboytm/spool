// Progressive-mount chunking for the share-editor preview. The fill
// state machine itself lives in @spool/share-kit (useProgressiveTurns)
// and is shared with the public reader — one implementation, so fixes
// to the scheduling/clamp semantics can't drift between surfaces. This
// module only pins the editor-tuned constants.

import {
  useProgressiveTurns,
  nextReaderCount,
} from '@spool/share-kit/progressive'

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
  return nextReaderCount(current, total, step)
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
  return useProgressiveTurns(total, initial, step)
}

// Turn selection + gap computation.
//
// Users can pick a subset of turns to feature in the artifact (see
// the "Passages" section in the control panel). Templates call
// `selectSegments` to get back the ordered list of kept turns plus
// a parallel array of how many turns were skipped immediately before
// each kept turn — so they can render "⋯ N turns skipped" markers
// when `opts.showGaps` is on.

import type { Conversation, EditorOpts, Turn } from '@/lib/types'

export interface KeptTurn extends Turn {
  /** Index in the original `convo.turns` array. */
  origIndex: number
}

export interface SelectedSegments {
  turns: KeptTurn[]
  /** Parallel to `turns`. `gapBefore[i]` = number of original turns
   *  skipped between the previous kept turn (or the conversation's
   *  start) and `turns[i]`. */
  gapBefore: number[]
  /** Total turns kept. */
  kept: number
  /** Total turns in the source conversation. */
  total: number
  /** True when fewer than all turns are being shown. */
  isExcerpt: boolean
}

export function selectSegments(convo: Conversation, opts: EditorOpts): SelectedSegments {
  const all = convo.turns
  const sel = opts.selected
  const keep = sel ? new Set(sel) : null
  const hideEmpty = opts.hideEmptyTurns

  const turns: KeptTurn[] = []
  const gapBefore: number[] = []
  let gap = 0

  for (let i = 0; i < all.length; i++) {
    if (keep !== null && !keep.has(i)) {
      gap++
      continue
    }
    if (hideEmpty && all[i]!.body.trim() === '' && !hasReplaySignal(all[i]!)) {
      gap++
      continue
    }
    turns.push({ ...all[i]!, origIndex: i })
    gapBefore.push(gap)
    gap = 0
  }

  return {
    turns,
    gapBefore,
    kept: turns.length,
    total: all.length,
    isExcerpt: turns.length !== all.length,
  }
}

function hasReplaySignal(turn: Turn): boolean {
  return (turn.replay?.toolNames?.length ?? 0) > 0
}

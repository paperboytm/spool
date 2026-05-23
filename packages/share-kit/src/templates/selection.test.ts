import { describe, expect, it } from 'vitest'
import type { Conversation, EditorOpts, Turn } from '@/lib/types'
import { DEFAULT_OPTS } from '@/lib/types'
import { selectSegments } from './selection'

function convo(turns: Turn[]): Conversation {
  return {
    source: 'claude',
    sourceLabel: 'Claude',
    origin: { kind: 'agent-session', agent: 'claude' },
    title: 'Replay',
    shareUrl: null,
    createdAt: '2026-01-01',
    wordCount: 0,
    readMin: 1,
    turns,
  }
}

function opts(overrides: Partial<EditorOpts> = {}): EditorOpts {
  return { ...DEFAULT_OPTS, ...overrides }
}

describe('selectSegments', () => {
  it('keeps empty turns when replay metadata carries tool names', () => {
    const segments = selectSegments(convo([
      { role: 'assistant', body: '', replay: { toolNames: ['Bash'] } },
      { role: 'assistant', body: '' },
      { role: 'user', body: 'done' },
    ]), opts({ hideEmptyTurns: true }))

    expect(segments.turns.map((turn) => turn.body)).toEqual(['', 'done'])
    expect(segments.turns[0]?.replay?.toolNames).toEqual(['Bash'])
    expect(segments.gapBefore).toEqual([0, 1])
  })
})

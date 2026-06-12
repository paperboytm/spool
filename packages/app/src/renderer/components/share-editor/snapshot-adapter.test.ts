import { describe, expect, it, vi } from 'vitest'
import type { Conversation, EditorOpts, Turn } from '@spool/share-kit'

// share-kit's main entry transitively imports a markdown helper that
// touches `document`. The adapter only needs `ensureTurnIds` (identity
// once IDs are present) and `redactConversation` (whose redact policy
// is already covered by share-kit's own unit tests). Stub both so this
// suite can run under the default Node test environment without jsdom.
vi.mock('@spool/share-kit', () => ({
  ensureTurnIds: (turns: Turn[]) => turns,
  redactConversation: (c: Conversation) => ({
    conversation: c,
    perTurnRedacted: new Set<string>(),
  }),
}))

import { buildSnapshotFromEditor } from './snapshot-adapter.js'

const API_KEY = 'sk_live_abcdef1234567890ABCDEF'

function convo(
  turns: Array<{ id?: string; role: 'user' | 'assistant'; body: string; author?: string }>,
): Conversation {
  return {
    source: 'claude',
    sourceLabel: 'Claude',
    origin: { kind: 'file', filename: 'fx.spool' },
    title: 'fixture',
    shareUrl: null,
    createdAt: '2026-05-19T00:00:00.000Z',
    wordCount: 0,
    readMin: 1,
    turns,
  }
}

function opts(override: Partial<EditorOpts> = {}): EditorOpts {
  return {
    template: 'chat',
    paper: 'snow',
    typeface: 'inter',
    colorway: 'amber',
    accentHex: '#C85A00',
    density: 'compact',
    redact: true,
    showGaps: true,
    showMasthead: true,
    showColophon: true,
    hideEmptyTurns: true,
    ...override,
  }
}

describe('buildSnapshotFromEditor — hidden-turn body redaction', () => {
  it('blanks the body of turns excluded via opts.selected before upload', () => {
    // Turn 1 contains a credential; opts.selected = [0] excludes it.
    // The snapshot still includes turn 1 (turn_order invariant) but
    // its content must be empty so the wire JSON carries no record
    // of what the author chose to hide.
    const conv = convo([
      { id: 't-0', role: 'user', body: 'hello' },
      { id: 't-1', role: 'assistant', body: `secret=${API_KEY}` },
    ])
    const snap = buildSnapshotFromEditor({
      conversation: conv,
      opts: opts({ redact: false, selected: [0] }),
    })
    // IDs are remapped to opaque positional tokens.
    expect(snap.conversation.turn_order).toEqual(['t0', 't1'])
    expect(snap.conversation.hidden_turns).toEqual(['t1'])
    const t0 = snap.conversation.turns.find((t) => t.id === 't0')!
    const t1 = snap.conversation.turns.find((t) => t.id === 't1')!
    expect(t0.content).toBe('hello')
    expect(t1.content).toBe('')
    // The R2 JSON must not retain the credential anywhere.
    expect(JSON.stringify(snap)).not.toContain(API_KEY)
  })

  it('keeps all bodies when opts.selected is undefined', () => {
    const conv = convo([
      { id: 't-0', role: 'user', body: 'hello' },
      { id: 't-1', role: 'assistant', body: 'world' },
    ])
    const snap = buildSnapshotFromEditor({
      conversation: conv,
      opts: opts({ redact: false }),
    })
    expect(snap.conversation.hidden_turns).toEqual([])
    expect(snap.conversation.turns.map((t) => t.content)).toEqual([
      'hello',
      'world',
    ])
  })

  it('blanks every body when no turns are selected', () => {
    const conv = convo([
      { id: 't-0', role: 'user', body: 'hello' },
      { id: 't-1', role: 'assistant', body: 'world' },
    ])
    const snap = buildSnapshotFromEditor({
      conversation: conv,
      opts: opts({ redact: false, selected: [] }),
    })
    expect(snap.conversation.hidden_turns).toEqual(['t0', 't1'])
    expect(snap.conversation.turns.every((t) => t.content === '')).toBe(true)
  })

  it('preserves turn_order alignment even when many turns are blanked', () => {
    const conv = convo([
      { id: 'a', role: 'user', body: 'A' },
      { id: 'b', role: 'assistant', body: 'B' },
      { id: 'c', role: 'user', body: 'C' },
    ])
    const snap = buildSnapshotFromEditor({
      conversation: conv,
      opts: opts({ redact: false, selected: [1] }),
    })
    // Positional remap: a→t0, b→t1, c→t2; b is the only kept turn.
    expect(snap.conversation.turn_order).toEqual(['t0', 't1', 't2'])
    expect(snap.conversation.turns).toHaveLength(3)
    expect(snap.conversation.hidden_turns.sort()).toEqual(['t0', 't2'])
  })
})

describe('buildSnapshotFromEditor — opaque positional ids', () => {
  // Regression for the content-derived-id leak: the original turn ids
  // (from `ensureTurnIds`, an fnv1a32 hash of the turn content) must
  // never appear anywhere in the emitted snapshot. This test FAILS on
  // the pre-fix code, which passed the original ids straight through to
  // turns[].id / turn_order[] / hidden_turns[].
  it('emits no content-derived id in turns, turn_order, or hidden_turns', () => {
    const originalIds = ['hash-9f3a', 'hash-2b71', 'hash-c40d']
    const conv = convo([
      { id: originalIds[0], role: 'user', body: 'public question' },
      { id: originalIds[1], role: 'assistant', body: `secret=${API_KEY}` },
      { id: originalIds[2], role: 'user', body: 'another public turn' },
    ])
    const snap = buildSnapshotFromEditor({
      conversation: conv,
      // Hide the credential-bearing middle turn.
      opts: opts({ redact: false, selected: [0, 2] }),
    })

    const emittedIds = [
      ...snap.conversation.turns.map((t) => t.id),
      ...snap.conversation.turn_order,
      ...snap.conversation.hidden_turns,
    ]
    for (const original of originalIds) {
      expect(emittedIds).not.toContain(original)
    }
    // The serialized wire object must not carry any original id either.
    const wire = JSON.stringify(snap)
    for (const original of originalIds) {
      expect(wire).not.toContain(original)
    }
    // Ids are opaque positional tokens, internally consistent.
    expect(snap.conversation.turn_order).toEqual(['t0', 't1', 't2'])
    expect(snap.conversation.hidden_turns).toEqual(['t1'])
    expect(snap.conversation.turns.find((t) => t.id === 't1')!.content).toBe('')
  })
})

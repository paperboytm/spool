import { describe, expect, it } from 'vitest'

import { snapshotFromSpoolDocument } from './spool-to-snapshot'
import type { SpoolDocument } from './types'

function doc(overrides: Partial<SpoolDocument['opts']> = {}): SpoolDocument {
  return {
    version: 2,
    exportedAt: '2026-07-16T12:00:00.000Z',
    conversation: {
      source: 'claude-code',
      sourceLabel: 'Claude Code',
      origin: { kind: 'agent-session', agent: 'claude', sessionUuid: 'abc' },
      title: 'Fix the OAuth callback',
      shareUrl: null,
      createdAt: '2026-07-16T10:00:00.000Z',
      wordCount: 12,
      readMin: 1,
      turns: [
        { role: 'user', body: 'please fix the callback' },
        { role: 'assistant', body: 'Done — PKCE now validates.' },
        { role: 'user', body: 'ship it' },
      ],
    },
    opts: {
      template: 'letter',
      paper: 'bone',
      typeface: 'geist',
      colorway: 'amber',
      accentHex: '#C85A00',
      density: 'compact',
      redact: true,
      showGaps: true,
      showMasthead: true,
      showColophon: false,
      hideEmptyTurns: true,
      ...overrides,
    },
  }
}

describe('snapshotFromSpoolDocument', () => {
  it('maps turns to opaque positional ids and carries editor opts', () => {
    const snapshot = snapshotFromSpoolDocument(doc())
    expect(snapshot.schema_version).toBe(1)
    expect(snapshot.source.kind).toBe('spool-session')
    expect(snapshot.conversation.title).toBe('Fix the OAuth callback')
    expect(snapshot.conversation.turns.map((t) => t.id)).toEqual(['t0', 't1', 't2'])
    expect(snapshot.conversation.turn_order).toEqual(['t0', 't1', 't2'])
    expect(snapshot.conversation.hidden_turns).toEqual([])
    expect(snapshot.editor_opts).toMatchObject({
      template: 'letter',
      paper: 'bone',
      masthead: true,
      colophon: false,
    })
  })

  it('blanks and lists turns excluded by the selection', () => {
    const snapshot = snapshotFromSpoolDocument(doc({ selected: [0, 2] }))
    expect(snapshot.conversation.hidden_turns).toEqual(['t1'])
    expect(snapshot.conversation.turns[1]?.content).toBe('')
    expect(snapshot.conversation.turns[0]?.content).toBe('please fix the callback')
  })

  it('marks non-agent origins as imported files and survives bad dates', () => {
    const document = doc()
    document.conversation.origin = { kind: 'file', filename: 'x.spool' }
    document.conversation.createdAt = 'June 2, 2026'
    const snapshot = snapshotFromSpoolDocument(document)
    expect(snapshot.source.kind).toBe('imported-file')
    expect(Number.isNaN(Date.parse(snapshot.source.captured_at))).toBe(false)
  })
})

import { describe, expect, it } from 'vite-plus/test'

import { DEFAULT_OPTS } from '../types'
import type { SpoolDocument, Turn } from '../types'
import { buildPreviewDocument, PREVIEW_TURN_COUNT } from './preview-document'

function makeTurn(i: number, body = `turn ${i}`): Turn {
  return {
    role: i % 2 === 0 ? 'user' : 'assistant',
    body,
  }
}

function makeDoc(turns: Turn[], optsOverrides: Partial<typeof DEFAULT_OPTS> = {}): SpoolDocument {
  return {
    version: 1,
    conversation: {
      source: 'claude',
      sourceLabel: 'Claude',
      origin: { kind: 'web-share', platform: 'Claude' },
      title: 'Test',
      shareUrl: null,
      createdAt: '2026-05-14T00:00:00.000Z',
      wordCount: turns.reduce((n, t) => n + t.body.split(/\s+/).length, 0),
      readMin: 1,
      turns,
    },
    opts: { ...DEFAULT_OPTS, ...optsOverrides },
    exportedAt: '2026-05-14T00:00:00.000Z',
  }
}

describe('buildPreviewDocument', () => {
  it('keeps the first N raw turns when there is no selection or hidden empties', () => {
    const turns = Array.from({ length: 10 }, (_, i) => makeTurn(i))
    const doc = makeDoc(turns, { selected: undefined, hideEmptyTurns: false })
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.turns).toHaveLength(PREVIEW_TURN_COUNT)
    expect(preview.conversation.turns.map((t) => t.body)).toEqual([
      'turn 0',
      'turn 1',
      'turn 2',
      'turn 3',
      'turn 4',
      'turn 5',
    ])
  })

  it('respects opts.selected — returns the first N KEPT turns, not raw 0..5', () => {
    // Regression: a user who excerpted [10, 20, 30, 40, 50, 60] used to
    // get the raw first 6 (none of which were selected), which then made
    // the thumbnail's downstream selectSegments render empty.
    const turns = Array.from({ length: 80 }, (_, i) => makeTurn(i))
    const doc = makeDoc(turns, { selected: [10, 20, 30, 40, 50, 60, 70] })
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.turns).toHaveLength(PREVIEW_TURN_COUNT)
    expect(preview.conversation.turns.map((t) => t.body)).toEqual([
      'turn 10',
      'turn 20',
      'turn 30',
      'turn 40',
      'turn 50',
      'turn 60',
    ])
  })

  it('respects hideEmptyTurns — fills from later turns when earlier ones are empty', () => {
    const turns: Turn[] = [
      makeTurn(0, 'a'),
      makeTurn(1, ''), // tool-only assistant turn
      makeTurn(2, '   '), // whitespace-only
      makeTurn(3, 'b'),
      makeTurn(4, 'c'),
      makeTurn(5, ''),
      makeTurn(6, 'd'),
      makeTurn(7, 'e'),
      makeTurn(8, 'f'),
      makeTurn(9, 'g'),
    ]
    const doc = makeDoc(turns, { selected: undefined, hideEmptyTurns: true })
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.turns.map((t) => t.body)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
  })

  it('clears opts.selected and opts.hideEmptyTurns on the preview document', () => {
    // The thumbnail's downstream selectSegments must not re-filter the
    // already-trimmed array (indices reference the ORIGINAL conversation,
    // not the trimmed preview).
    const doc = makeDoc(
      Array.from({ length: 10 }, (_, i) => makeTurn(i)),
      { selected: [0, 2, 4], hideEmptyTurns: true },
    )
    const preview = buildPreviewDocument(doc)
    expect(preview.opts.selected).toBeUndefined()
    expect(preview.opts.hideEmptyTurns).toBe(false)
  })

  it('preserves non-selection opts (template, paper, typeface, colorway, accentHex)', () => {
    const doc = makeDoc([makeTurn(0)], {
      template: 'timeline',
      paper: 'graphite',
      typeface: 'fraunces',
      colorway: 'walnut',
      accentHex: '#9F7A4C',
    })
    const preview = buildPreviewDocument(doc)
    expect(preview.opts.template).toBe('timeline')
    expect(preview.opts.paper).toBe('graphite')
    expect(preview.opts.typeface).toBe('fraunces')
    expect(preview.opts.colorway).toBe('walnut')
    expect(preview.opts.accentHex).toBe('#9F7A4C')
  })

  it('preserves conversation metadata (source, title, createdAt)', () => {
    const doc = makeDoc([makeTurn(0), makeTurn(1)])
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.source).toBe(doc.conversation.source)
    expect(preview.conversation.title).toBe(doc.conversation.title)
    expect(preview.conversation.createdAt).toBe(doc.conversation.createdAt)
  })

  it('strips origIndex from preview turns (stays Turn-shaped, not KeptTurn-shaped)', () => {
    const doc = makeDoc([makeTurn(0)])
    const preview = buildPreviewDocument(doc)
    const t = preview.conversation.turns[0] as Turn & { origIndex?: number }
    expect('origIndex' in t).toBe(false)
  })

  it('handles fewer-than-N turns without padding', () => {
    const doc = makeDoc([makeTurn(0), makeTurn(1), makeTurn(2)])
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.turns).toHaveLength(3)
  })

  it('handles empty selection — returns 0 turns rather than throwing', () => {
    const doc = makeDoc(
      Array.from({ length: 10 }, (_, i) => makeTurn(i)),
      { selected: [] },
    )
    const preview = buildPreviewDocument(doc)
    expect(preview.conversation.turns).toHaveLength(0)
  })
})

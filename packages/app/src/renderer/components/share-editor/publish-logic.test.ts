import { describe, expect, it } from 'vitest'
import {
  computeExpiresAt,
  computeUnredactedMatches,
  truncatePreview,
} from './publish-logic.js'
import type { Snapshot } from '../../../shared/share-publish.js'

function snap(overrides: Partial<Snapshot['conversation']> & {
  redactions?: Snapshot['redactions']
}): Snapshot {
  const turns = overrides.turns ?? []
  const turn_order = overrides.turn_order ?? turns.map((t) => t.id)
  const hidden_turns = overrides.hidden_turns ?? []
  return {
    schema_version: 1,
    source: { kind: 'spool-session', captured_at: '2026-05-19T00:00:00.000Z' },
    conversation: {
      title: 'fixture',
      turns,
      turn_order,
      hidden_turns,
    },
    edits: [],
    redactions: overrides.redactions ?? [],
    editor_opts: {
      template: 'chat',
      paper: 'snow',
      typeface: 'inter',
      colorway: 'amber',
      density: 'compact',
      masthead: true,
      colophon: true,
      avatars: true,
      show_byline: false,
    },
  }
}

const API_KEY = 'sk_live_abcdef1234567890ABCDEF'

describe('truncatePreview', () => {
  it('returns the value untouched when ≤ 16 chars', () => {
    expect(truncatePreview('hello')).toBe('hello')
    expect(truncatePreview('a'.repeat(16))).toBe('a'.repeat(16))
  })

  it('truncates to 16 chars + ellipsis when longer', () => {
    expect(truncatePreview('a'.repeat(40))).toBe('a'.repeat(16) + '…')
  })
})

describe('computeUnredactedMatches', () => {
  it('returns an empty list for a turn with no sensitive content', () => {
    const s = snap({
      turns: [{ id: 't1', role: 'user', content: 'just a friendly hello' }],
    })
    expect(computeUnredactedMatches(s)).toEqual([])
  })

  it('does NOT surface a match whose span is fully covered by a redaction', () => {
    const text = `here is my secret ${API_KEY} please ignore`
    const start = text.indexOf(API_KEY)
    const end = start + API_KEY.length
    const s = snap({
      turns: [{ id: 't1', role: 'user', content: text }],
      redactions: [{ turn_id: 't1', span: [start, end], label: 'api-key' }],
    })
    expect(computeUnredactedMatches(s)).toEqual([])
  })

  it('surfaces an uncovered match and truncates the preview', () => {
    const text = `key is ${API_KEY}`
    const s = snap({
      turns: [{ id: 't1', role: 'user', content: text }],
    })
    const out = computeUnredactedMatches(s)
    expect(out.length).toBeGreaterThan(0)
    const m = out[0]!
    expect(m.turn_id).toBe('t1')
    expect(m.kind).toBe('api-key')
    expect(m.label).toBe('API key')
    // preview is truncated when the literal exceeds 16 chars
    expect(m.preview.length).toBeLessThanOrEqual(17) // 16 + ellipsis
    expect(m.preview.endsWith('…')).toBe(true)
    // never the full secret
    expect(m.preview).not.toBe(API_KEY)
  })

  it('skips hidden turns entirely', () => {
    const s = snap({
      turns: [
        { id: 'visible', role: 'user', content: 'hi' },
        { id: 'hidden', role: 'user', content: `oops ${API_KEY}` },
      ],
      hidden_turns: ['hidden'],
    })
    expect(computeUnredactedMatches(s)).toEqual([])
  })

  it('preserves kind for multiple matches and turns', () => {
    const s = snap({
      turns: [
        { id: 't1', role: 'user', content: `first ${API_KEY}` },
        { id: 't2', role: 'assistant', content: 'reach me at alice@acme.io' },
      ],
    })
    const out = computeUnredactedMatches(s)
    const kinds = out.map((m) => m.kind)
    expect(kinds).toContain('api-key')
    expect(kinds).toContain('email')
  })

  it('treats partial overlap as uncovered (range must fully contain the match)', () => {
    const text = `key is ${API_KEY}`
    const start = text.indexOf(API_KEY)
    // Redact only the first 3 chars of the match — should still surface.
    const s = snap({
      turns: [{ id: 't1', role: 'user', content: text }],
      redactions: [{ turn_id: 't1', span: [start, start + 3], label: 'partial' }],
    })
    const out = computeUnredactedMatches(s)
    expect(out.length).toBeGreaterThan(0)
  })
})

describe('computeExpiresAt', () => {
  const NOW = Date.UTC(2026, 0, 1, 0, 0, 0) // 2026-01-01T00:00:00Z

  it('returns undefined for "never"', () => {
    expect(computeExpiresAt({ kind: 'never' }, NOW)).toBeUndefined()
  })

  it('returns now + 7 days for "7d"', () => {
    expect(computeExpiresAt({ kind: '7d' }, NOW)).toBe('2026-01-08T00:00:00.000Z')
  })

  it('returns now + 30 days for "30d"', () => {
    expect(computeExpiresAt({ kind: '30d' }, NOW)).toBe('2026-01-31T00:00:00.000Z')
  })

  it('returns ISO of parsed datetime-local for "custom"', () => {
    const iso = computeExpiresAt({ kind: 'custom', custom: '2026-06-15T12:30' }, NOW)
    expect(iso).toMatch(/^2026-06-15T/)
    expect(new Date(iso!).toISOString()).toBe(iso!)
  })

  it('returns undefined for "custom" with empty/invalid input', () => {
    expect(computeExpiresAt({ kind: 'custom', custom: '' }, NOW)).toBeUndefined()
    expect(computeExpiresAt({ kind: 'custom', custom: 'garbage' }, NOW)).toBeUndefined()
  })
})

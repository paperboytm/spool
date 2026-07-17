import { describe, expect, it } from 'vitest'
import { hashValueForRedactExclude } from '@spool-lab/redact'
import type { Conversation, EditorOpts } from '@spool/share-kit'

import {
  computeUnredactedMatches,
  publishErrorKey,
  truncatePreview,
} from './publish-logic.js'
import enLocale from '../../i18n/locales/en.json'

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
  it('returns empty high+medium for a clean conversation', () => {
    const c = convo([{ role: 'user', body: 'just a friendly hello' }])
    const r = computeUnredactedMatches(c, opts())
    expect(r.high).toEqual([])
    expect(r.medium).toEqual([])
  })

  it('puts an API key into the high tier and an email into the medium tier', () => {
    const c = convo([
      { role: 'user', body: `key is ${API_KEY}` },
      { role: 'assistant', body: 'reach me at alice@acme.io' },
    ])
    // redact: false so the policy doesn't cover anything — both matches surface.
    const r = computeUnredactedMatches(c, opts({ redact: false }))
    expect(r.high.map((m) => m.kind)).toContain('api-key')
    expect(r.medium.map((m) => m.kind)).toContain('email')
    // preview truncation is applied
    const apiKeyMatch = r.high.find((m) => m.kind === 'api-key')!
    expect(apiKeyMatch.preview.length).toBeLessThanOrEqual(17)
    expect(apiKeyMatch.preview).not.toBe(API_KEY)
  })

  it('drops matches the current redact policy would mask', () => {
    const c = convo([
      { role: 'user', body: `key is ${API_KEY}` },
      { role: 'assistant', body: 'reach me at alice@acme.io' },
    ])
    // redact: true with no exclusions → both kinds get masked at
    // publish time, so neither tier surfaces anything.
    const r = computeUnredactedMatches(c, opts({ redact: true }))
    expect(r.high).toEqual([])
    expect(r.medium).toEqual([])
  })

  it('respects redactExclude.kinds — excluded kind still appears in matches', () => {
    const c = convo([
      { role: 'user', body: `key is ${API_KEY}` },
      { role: 'assistant', body: 'reach me at alice@acme.io' },
    ])
    // User said "don't redact emails" → email surfaces as medium;
    // API key still gets redacted by policy so it stays hidden.
    const r = computeUnredactedMatches(
      c,
      opts({ redact: true, redactExclude: { kinds: ['email'] } }),
    )
    expect(r.high).toEqual([])
    expect(r.medium.map((m) => m.kind)).toContain('email')
  })

  it('respects redactExclude.valueHashes for a specific literal', () => {
    const c = convo([
      { role: 'user', body: `key is ${API_KEY}` },
      { role: 'assistant', body: 'reach me at alice@acme.io' },
    ])
    const r = computeUnredactedMatches(
      c,
      opts({
        redact: true,
        redactExclude: {
          valueHashes: [hashValueForRedactExclude(API_KEY)],
        },
      }),
    )
    // The literal API_KEY was excluded by hash → it surfaces (high).
    expect(r.high.some((m) => m.kind === 'api-key')).toBe(true)
    // The email is still policy-covered.
    expect(r.medium).toEqual([])
  })

  it('reports turn_index for matches in later turns', () => {
    const c = convo([
      { role: 'user', body: 'plain' },
      { role: 'assistant', body: `oh and ${API_KEY}` },
    ])
    const r = computeUnredactedMatches(c, opts({ redact: false }))
    const m = r.high.find((x) => x.kind === 'api-key')!
    expect(m.turn_index).toBe(1)
  })
})

describe('computeUnredactedMatches — hidden turns', () => {
  it('skips matches in turns excluded by opts.selected (TurnSelector)', () => {
    // Two turns, both contain credentials. opts.selected only includes
    // turn 0 → matches in turn 1 are not reported, since that turn's
    // body won't be published.
    const conv = convo([
      { id: 't-0', role: 'assistant', body: `key=${API_KEY}` },
      { id: 't-1', role: 'assistant', body: `key=${API_KEY}` },
    ])
    const r = computeUnredactedMatches(
      conv,
      opts({ redact: false, selected: [0] }),
    )
    expect(r.high.every((m) => m.turn_index !== 1)).toBe(true)
    expect(r.high.some((m) => m.turn_index === 0)).toBe(true)
  })

  it('reports all turns when opts.selected is undefined (no TurnSelector active)', () => {
    const conv = convo([
      { id: 't-0', role: 'assistant', body: `key=${API_KEY}` },
      { id: 't-1', role: 'assistant', body: `key=${API_KEY}` },
    ])
    const r = computeUnredactedMatches(conv, opts({ redact: false }))
    const turnIdxs = new Set(r.high.map((m) => m.turn_index))
    expect(turnIdxs.has(0)).toBe(true)
    expect(turnIdxs.has(1)).toBe(true)
  })

  it('reports nothing when all turns are excluded', () => {
    const conv = convo([
      { id: 't-0', role: 'assistant', body: `key=${API_KEY}` },
    ])
    const r = computeUnredactedMatches(
      conv,
      opts({ redact: false, selected: [] }),
    )
    expect(r.high).toEqual([])
    expect(r.medium).toEqual([])
  })
})

describe('publishErrorKey', () => {
  it('maps the statuses with dedicated copy to i18n keys that exist', () => {
    const en = enLocale as Record<string, unknown>
    const resolve = (key: string): unknown =>
      key.split('.').reduce<unknown>((node, part) => {
        return node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
      }, en)
    for (const status of [401, 413, 429]) {
      const key = publishErrorKey(status)
      expect(key, `status ${status}`).toBeTruthy()
      // Guard against typo'd keys rendering raw like
      // "shareEditor.publishTab.error_tooLarge" in the error banner.
      expect(typeof resolve(key!), `key ${key} missing from en.json`).toBe('string')
    }
  })

  it('returns null for statuses without dedicated copy (backend detail surfaces)', () => {
    expect(publishErrorKey(422)).toBeNull()
    expect(publishErrorKey(500)).toBeNull()
    expect(publishErrorKey(0)).toBeNull()
  })
})

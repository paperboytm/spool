import { describe, it, expect, afterEach, vi } from 'vitest'
import type { SensitiveMatch } from '@spool-lab/redact'
import {
  mapPfMatch,
  mapPfMatches,
  setUnknownLabelSink,
  type PfRawMatch,
} from './class-mapping.js'

const regex = (kind: SensitiveMatch['kind'], start: number, end: number): SensitiveMatch => ({
  kind, value: '', start, end, confidence: 0.95, provider: 'regex',
})

describe('class mapping — kept classes (high-precision on PII-only setting)', () => {
  it('email → email', () => {
    const pf: PfRawMatch = { class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.95 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'a@b.c' })?.kind).toBe('email')
  })
  it('phone → phone', () => {
    const pf: PfRawMatch = { class: 'phone', value: '+1234567890', start: 0, end: 11, score: 0.92 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: '+1234567890' })?.kind).toBe('phone')
  })
})

describe('class mapping — disabled classes (precision too low without clues)', () => {
  // person / address / url / account_number sit at P=0.62-0.82 on the
  // model card's "PII only" setting (Spool's actual content shape).
  // Each kind is suppressed entirely until either domain fine-tune or
  // a shape filter that survives technical content.
  for (const cls of ['person', 'address', 'url', 'account_number'] as const) {
    it(`${cls} is always suppressed`, () => {
      const pf: PfRawMatch = { class: cls, value: 'whatever', start: 0, end: 8, score: 0.99 }
      expect(mapPfMatch(pf, { regexMatches: [], fullText: 'whatever' })).toBeNull()
    })
  }
})

describe('class mapping — confidence floor', () => {
  it('drops any match below 0.85 even if class would otherwise pass', () => {
    const pf: PfRawMatch = { class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.84 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'a@b.c' })).toBeNull()
  })
  it('keeps matches at 0.85 exactly', () => {
    const pf: PfRawMatch = { class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.85 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'a@b.c' })?.kind).toBe('email')
  })
})

describe('class mapping — suppression rules', () => {
  it('secret overlapping a regex generic-secret → generic-secret (boost)', () => {
    const pf: PfRawMatch = { class: 'secret', value: 'xyz', start: 5, end: 8, score: 0.9 }
    const out = mapPfMatch(pf, {
      regexMatches: [regex('generic-secret', 0, 20)],
      fullText: 'token = "xyz" plus extra',
    })
    expect(out?.kind).toBe('generic-secret')
  })

  describe('secret standalone (no regex overlap) safety net', () => {
    // Real-shape standalone secret — high score, ≥16 chars, high entropy.
    // Should land as generic-secret since regex doesn't know this prefix.
    it('high-confidence high-entropy ≥16 chars passes', () => {
      const value = 'j82H1xK9pQrSt7VwYzA3bC5dF8gJ'  // 28 random mixed chars
      const pf: PfRawMatch = { class: 'secret', value, start: 0, end: value.length, score: 0.97 }
      expect(mapPfMatch(pf, { regexMatches: [], fullText: value })?.kind).toBe('generic-secret')
    })
    it('drops below confidence 0.95', () => {
      const value = 'j82H1xK9pQrSt7VwYzA3bC5dF8gJ'
      const pf: PfRawMatch = { class: 'secret', value, start: 0, end: value.length, score: 0.94 }
      expect(mapPfMatch(pf, { regexMatches: [], fullText: value })).toBeNull()
    })
    it('drops below 16 chars even at high confidence', () => {
      const pf: PfRawMatch = { class: 'secret', value: 'shortpw1234', start: 0, end: 11, score: 0.99 }
      expect(mapPfMatch(pf, { regexMatches: [], fullText: 'shortpw1234' })).toBeNull()
    })
    it('drops low-entropy strings (placeholder passwords)', () => {
      const value = 'changemechangeme'  // 16 chars but repetitive — low entropy
      const pf: PfRawMatch = { class: 'secret', value, start: 0, end: value.length, score: 0.99 }
      expect(mapPfMatch(pf, { regexMatches: [], fullText: value })).toBeNull()
    })
  })

  it('date alone is suppressed', () => {
    const pf: PfRawMatch = { class: 'date', value: '1990-05-15', start: 0, end: 10, score: 0.85 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'random text 1990-05-15 nothing here' })).toBeNull()
  })

  it('date with DOB context → date-of-birth', () => {
    const pf: PfRawMatch = { class: 'date', value: '1990-05-15', start: 14, end: 24, score: 0.85 }
    const out = mapPfMatch(pf, {
      regexMatches: [],
      fullText: 'date of birth 1990-05-15 from form',
    })
    expect(out?.kind).toBe('date-of-birth')
  })

  it('date with DOB-like prefix is gated case-insensitively', () => {
    const pf: PfRawMatch = { class: 'date', value: '2002-11-09', start: 5, end: 15, score: 0.85 }
    const out = mapPfMatch(pf, {
      regexMatches: [],
      fullText: 'DOB: 2002-11-09',
    })
    expect(out?.kind).toBe('date-of-birth')
  })

  it('unknown labels are dropped without throwing', () => {
    // score ≥ 0.85 so it clears the confidence floor and actually
    // reaches the unknown-label branch in mapClass().
    const pf: PfRawMatch = { class: 'wat-is-this', value: 'x', start: 0, end: 1, score: 0.99 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'x' })).toBeNull()
  })
})

describe('class mapping — unknown-label observability', () => {
  afterEach(() => {
    // Restore the default no-op sink between cases.
    setUnknownLabelSink(() => {})
  })

  it('invokes the sink with the unknown label (still drops the match)', () => {
    const sink = vi.fn()
    setUnknownLabelSink(sink)
    const pf: PfRawMatch = { class: 'new_model_class', value: 'secret-ish', start: 0, end: 10, score: 0.99 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'secret-ish' })).toBeNull()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith('new_model_class')
  })

  it('passes only the label, never the matched value', () => {
    const sink = vi.fn()
    setUnknownLabelSink(sink)
    const pf: PfRawMatch = { class: 'mystery', value: 'sensitive-user-content', start: 0, end: 22, score: 0.9 }
    mapPfMatch(pf, { regexMatches: [], fullText: 'sensitive-user-content' })
    expect(sink).toHaveBeenCalledWith('mystery')
    expect(sink.mock.calls[0]).not.toContain('sensitive-user-content')
  })

  it('does NOT fire for known or confidence-floored classes', () => {
    const sink = vi.fn()
    setUnknownLabelSink(sink)
    // known class
    mapPfMatch({ class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.99 }, { regexMatches: [], fullText: 'a@b.c' })
    // unknown but below the 0.85 floor — dropped before mapClass()
    mapPfMatch({ class: 'mystery', value: 'x', start: 0, end: 1, score: 0.5 }, { regexMatches: [], fullText: 'x' })
    expect(sink).not.toHaveBeenCalled()
  })

  it('setUnknownLabelSink returns the previous sink for restoration', () => {
    const first = vi.fn()
    const second = vi.fn()
    const restoredToFirst = setUnknownLabelSink(first)
    const prev = setUnknownLabelSink(second)
    expect(prev).toBe(first)
    void restoredToFirst
  })

  it('fires once per unknown match in a bulk map', () => {
    const sink = vi.fn()
    setUnknownLabelSink(sink)
    const pf: PfRawMatch[] = [
      { class: 'mystery_a', value: 'p', start: 0, end: 1, score: 0.99 },
      { class: 'email', value: 'a@b.c', start: 2, end: 7, score: 0.99 },
      { class: 'mystery_b', value: 'q', start: 8, end: 9, score: 0.99 },
    ]
    const out = mapPfMatches(pf, { regexMatches: [], fullText: 'p a@b.c q' })
    expect(out.map((m) => m.kind)).toEqual(['email'])
    expect(sink.mock.calls.map((c) => c[0])).toEqual(['mystery_a', 'mystery_b'])
  })
})

describe('mapPfMatches', () => {
  it('drops suppressed entries while keeping the rest', () => {
    const pf: PfRawMatch[] = [
      { class: 'person', value: 'Maya', start: 0, end: 4, score: 0.9 },           // disabled class
      { class: 'account_number', value: '0123456', start: 10, end: 17, score: 0.95 }, // disabled class
      { class: 'email', value: 'a@b.c', start: 20, end: 25, score: 0.9 },         // kept
    ]
    const out = mapPfMatches(pf, { regexMatches: [], fullText: 'Maya       0123456    a@b.c' })
    expect(out.map(m => m.kind)).toEqual(['email'])
  })
})

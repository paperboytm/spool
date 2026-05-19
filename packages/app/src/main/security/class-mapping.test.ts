import { describe, it, expect } from 'vitest'
import type { SensitiveMatch } from '@spool-lab/redact'
import { mapPfMatch, mapPfMatches, type PfRawMatch } from './class-mapping.js'

const regex = (kind: SensitiveMatch['kind'], start: number, end: number): SensitiveMatch => ({
  kind, value: '', start, end, confidence: 0.95, provider: 'regex',
})

describe('class mapping — direct mappings', () => {
  it('person → person-name', () => {
    const pf: PfRawMatch = { class: 'person', value: 'Maya', start: 0, end: 4, score: 0.9 }
    const out = mapPfMatch(pf, { regexMatches: [], fullText: 'Maya' })
    expect(out?.kind).toBe('person-name')
    expect(out?.provider).toBe('pf')
  })
  it('email → email', () => {
    const pf: PfRawMatch = { class: 'email', value: 'a@b.c', start: 0, end: 5, score: 0.95 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'a@b.c' })?.kind).toBe('email')
  })
  it('phone → phone', () => {
    const pf: PfRawMatch = { class: 'phone', value: '+1234567890', start: 0, end: 11, score: 0.92 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: '+1234567890' })?.kind).toBe('phone')
  })
  it('address → street-address', () => {
    const pf: PfRawMatch = { class: 'address', value: '1 Main St', start: 0, end: 9, score: 0.88 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: '1 Main St' })?.kind).toBe('street-address')
  })
})

describe('class mapping — suppression rules', () => {
  it('url with no overlapping regex url-creds is suppressed', () => {
    const pf: PfRawMatch = { class: 'url', value: 'https://example.com', start: 0, end: 19, score: 0.9 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'https://example.com' })).toBeNull()
  })
  it('url overlapping a regex url-creds match → url-creds (boost)', () => {
    const pf: PfRawMatch = { class: 'url', value: 'https://u:p@x.com', start: 0, end: 17, score: 0.9 }
    const out = mapPfMatch(pf, {
      regexMatches: [regex('url-creds', 0, 17)],
      fullText: 'https://u:p@x.com',
    })
    expect(out?.kind).toBe('url-creds')
  })

  it('account_number is always suppressed', () => {
    const pf: PfRawMatch = { class: 'account_number', value: '4111 1111 1111 1111', start: 0, end: 19, score: 0.95 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: '4111 1111 1111 1111' })).toBeNull()
  })

  it('secret with no regex generic-secret nearby is suppressed', () => {
    const pf: PfRawMatch = { class: 'secret', value: 'abc', start: 0, end: 3, score: 0.7 }
    expect(mapPfMatch(pf, { regexMatches: [], fullText: 'abc' })).toBeNull()
  })

  it('secret overlapping a regex generic-secret → generic-secret (boost)', () => {
    const pf: PfRawMatch = { class: 'secret', value: 'xyz', start: 5, end: 8, score: 0.7 }
    const out = mapPfMatch(pf, {
      regexMatches: [regex('generic-secret', 0, 20)],
      fullText: 'token = "xyz" plus extra',
    })
    expect(out?.kind).toBe('generic-secret')
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
})

describe('mapPfMatches', () => {
  it('drops suppressed entries while keeping the rest', () => {
    const pf: PfRawMatch[] = [
      { class: 'person', value: 'Maya', start: 0, end: 4, score: 0.9 },
      { class: 'account_number', value: '0123456', start: 10, end: 17, score: 0.95 },
      { class: 'email', value: 'a@b.c', start: 20, end: 25, score: 0.9 },
    ]
    const out = mapPfMatches(pf, { regexMatches: [], fullText: 'Maya       0123456    a@b.c' })
    expect(out.map(m => m.kind)).toEqual(['person-name', 'email'])
  })
})

import { describe, it, expect } from 'vitest'
import { parseQualifier, withQualifier, toggleKindQualifier } from './parse-qualifier.js'

describe('parseQualifier', () => {
  it('empty string yields empty filter', () => {
    expect(parseQualifier('').filter).toEqual({})
    expect(parseQualifier('   ').filter).toEqual({})
  })

  it('a bare phrase becomes free text on filter.text', () => {
    const p = parseQualifier('aws migration')
    expect(p.filter.text).toBe('aws migration')
    expect(p.text).toBe('aws migration')
  })

  it('kind: maps to filter.kind', () => {
    expect(parseQualifier('kind:api-key').filter.kind).toBe('api-key')
  })

  it('is:active, dismissed, purged, any are recognised', () => {
    expect(parseQualifier('is:active').filter.state).toBe('active')
    expect(parseQualifier('is:dismissed').filter.state).toBe('dismissed')
    expect(parseQualifier('is:purged').filter.state).toBe('purged')
    expect(parseQualifier('is:any').filter.state).toBe('any')
  })

  it('is:ignored is the preferred spelling, mapping to the internal dismissed state', () => {
    expect(parseQualifier('is:ignored').filter.state).toBe('dismissed')
  })

  it('is:dismissed stays accepted as a backward-compat alias for is:ignored', () => {
    expect(parseQualifier('is:dismissed').filter.state)
      .toBe(parseQualifier('is:ignored').filter.state)
  })

  it('is: with unknown value is treated as free text, not silently dropped', () => {
    const p = parseQualifier('is:wat')
    expect(p.filter.state).toBeUndefined()
    expect(p.filter.text).toBe('is:wat')
  })

  it('severity:high / low are recognised, anything else is free text', () => {
    expect(parseQualifier('severity:high').filter.severity).toBe('high')
    expect(parseQualifier('severity:low').filter.severity).toBe('low')
    expect(parseQualifier('severity:medium').filter.severity).toBeUndefined()
  })

  it('session:<uuid> pulls into sessionUuid, not filter', () => {
    const p = parseQualifier('session:abc-123')
    expect(p.sessionUuid).toBe('abc-123')
    expect(p.filter.kind).toBeUndefined()
  })

  it('mixes qualifiers in any order with free text', () => {
    const p = parseQualifier('aws kind:api-key is:active severity:high migrate')
    expect(p.filter.kind).toBe('api-key')
    expect(p.filter.state).toBe('active')
    expect(p.filter.severity).toBe('high')
    expect(p.filter.text).toBe('aws migrate')
  })

  it('qualifier names are case-insensitive', () => {
    expect(parseQualifier('KIND:api-key').filter.kind).toBe('api-key')
    expect(parseQualifier('IS:active').filter.state).toBe('active')
  })

  it('token with empty value is treated as free text (e.g. trailing colon)', () => {
    const p = parseQualifier('kind: extra')
    expect(p.filter.kind).toBeUndefined()
    expect(p.filter.text).toBe('kind: extra')
  })

  it('token with leading colon is treated as free text', () => {
    const p = parseQualifier(':active')
    expect(p.filter.state).toBeUndefined()
    expect(p.filter.text).toBe(':active')
  })

  it('multiple kind: tokens accumulate into kinds[]', () => {
    const p = parseQualifier('kind:api-key kind:jwt aws')
    expect(p.filter.kinds).toEqual(['api-key', 'jwt'])
    // Singular `kind` falls back to the first one so old callers still work.
    expect(p.filter.kind).toBe('api-key')
    expect(p.filter.text).toBe('aws')
  })

  it('duplicate kind: tokens dedupe', () => {
    const p = parseQualifier('kind:api-key kind:api-key')
    expect(p.filter.kinds).toEqual(['api-key'])
  })
})

describe('withQualifier', () => {
  it('adds a qualifier when none of that name exists', () => {
    expect(withQualifier('aws', 'kind', 'api-key')).toBe('kind:api-key aws')
  })

  it('replaces an existing qualifier of the same name', () => {
    expect(withQualifier('kind:email aws', 'kind', 'api-key')).toBe('kind:api-key aws')
  })

  it('preserves other qualifiers and free text', () => {
    expect(withQualifier('is:active severity:high', 'kind', 'jwt'))
      .toBe('kind:jwt is:active severity:high')
  })

  it('idempotent: parsing back then rebuilding is structural', () => {
    const out = withQualifier('aws migrate', 'kind', 'api-key')
    const parsed = parseQualifier(out)
    expect(parsed.filter.kind).toBe('api-key')
    expect(parsed.filter.text).toBe('aws migrate')
  })
})

describe('toggleKindQualifier', () => {
  it('adds a kind when not present', () => {
    expect(toggleKindQualifier('', 'api-key')).toBe('kind:api-key')
    expect(toggleKindQualifier('aws', 'api-key')).toBe('kind:api-key aws')
  })
  it('removes a kind when already present, leaving the rest intact', () => {
    expect(toggleKindQualifier('kind:api-key', 'api-key')).toBe('')
    expect(toggleKindQualifier('kind:api-key kind:jwt aws', 'api-key')).toBe('kind:jwt aws')
  })
  it('two clicks of the same kind return to the original state', () => {
    const after = toggleKindQualifier(toggleKindQualifier('aws', 'api-key'), 'api-key')
    expect(after).toBe('aws')
  })
})

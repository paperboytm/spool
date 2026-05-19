import { describe, expect, it } from 'vitest'

import { nextSafe, routeFor } from './route'

describe('routeFor', () => {
  it('matches /s/<valid-slug> as reader', () => {
    const r = routeFor('/s/K7s4F3pQz1mB9XnLrV8aE')
    expect(r).toEqual({ kind: 'reader', id: 'K7s4F3pQz1mB9XnLrV8aE' })
  })

  it('matches /s/<valid-slug>/ (trailing slash) as reader', () => {
    const r = routeFor('/s/K7s4F3pQz1mB9XnLrV8aE/')
    expect(r.kind).toBe('reader')
  })

  it('rejects too-short slugs as tombstone', () => {
    const r = routeFor('/s/abc')
    expect(r).toEqual({ kind: 'tombstone', reason: 'not-found' })
  })

  it('rejects slugs with disallowed characters as tombstone', () => {
    const r = routeFor('/s/K7s4F3pQz1mB9XnLrV8a!')
    expect(r.kind).toBe('tombstone')
  })

  it('falls through to tombstone for unknown paths', () => {
    expect(routeFor('/').kind).toBe('tombstone')
    expect(routeFor('/me').kind).toBe('tombstone')
    expect(routeFor('/@someone').kind).toBe('tombstone')
    expect(routeFor('/report').kind).toBe('tombstone')
  })
})

describe('nextSafe', () => {
  it('passes same-origin paths', () => {
    expect(nextSafe('/me')).toBe('/me')
    expect(nextSafe('/s/K7s4F3pQz1mB9XnLrV8aE')).toBe('/s/K7s4F3pQz1mB9XnLrV8aE')
  })

  it('rejects absolute URLs', () => {
    expect(nextSafe('https://evil.com')).toBe('/')
    expect(nextSafe('http://evil.com')).toBe('/')
  })

  it('rejects protocol-relative URLs', () => {
    expect(nextSafe('//evil.com')).toBe('/')
  })

  it('rejects backslash sneakers', () => {
    expect(nextSafe('/\\evil.com')).toBe('/')
  })

  it('rejects path traversal', () => {
    expect(nextSafe('/../evil')).toBe('/')
    expect(nextSafe('/foo/../bar')).toBe('/')
  })

  it('rejects javascript: scheme', () => {
    expect(nextSafe('javascript:alert(1)')).toBe('/')
    expect(nextSafe('/javascript:alert(1)')).toBe('/')
  })

  it('falls through to / for nullish input', () => {
    expect(nextSafe(null)).toBe('/')
    expect(nextSafe(undefined)).toBe('/')
    expect(nextSafe('')).toBe('/')
  })
})

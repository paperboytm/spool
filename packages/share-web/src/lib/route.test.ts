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
    expect(routeFor('/random').kind).toBe('tombstone')
    expect(routeFor('/report').kind).toBe('tombstone')
  })

  it('matches /me as me', () => {
    expect(routeFor('/me')).toEqual({ kind: 'me' })
  })

  it('matches /terms and /privacy as legal pages', () => {
    expect(routeFor('/terms')).toEqual({ kind: 'terms' })
    expect(routeFor('/privacy')).toEqual({ kind: 'privacy' })
    // Trailing slashes normalize like every other route.
    expect(routeFor('/terms/')).toEqual({ kind: 'terms' })
    // Subpaths are not legal pages.
    expect(routeFor('/terms/extra').kind).toBe('tombstone')
  })

  it('matches /@<handle> as profile', () => {
    expect(routeFor('/@alice')).toEqual({ kind: 'profile', handle: 'alice' })
  })

  it('lowercases the handle in /@<handle>', () => {
    expect(routeFor('/@Alice')).toEqual({ kind: 'profile', handle: 'alice' })
  })

  it('rejects invalid handles (too short)', () => {
    expect(routeFor('/@ab').kind).toBe('tombstone')
  })

  it('rejects invalid handles (illegal chars)', () => {
    expect(routeFor('/@bad!!').kind).toBe('tombstone')
  })

  it('rejects handles that start with a digit', () => {
    expect(routeFor('/@2bad').kind).toBe('tombstone')
  })

  it('matches /sign-in with sanitized next', () => {
    expect(routeFor('/sign-in', '?next=/me')).toEqual({ kind: 'sign-in', next: '/me' })
  })

  it('matches /sign-in without next (default /)', () => {
    expect(routeFor('/sign-in')).toEqual({ kind: 'sign-in', next: '/' })
  })

  it('sanitizes evil next on /sign-in', () => {
    expect(routeFor('/sign-in', '?next=//evil.com')).toEqual({ kind: 'sign-in', next: '/' })
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

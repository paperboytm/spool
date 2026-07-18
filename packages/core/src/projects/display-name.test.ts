import { describe, it, expect } from 'vite-plus/test'

import { fallbackDisplayName } from './display-name.js'

describe('fallbackDisplayName', () => {
  it('returns last path segment', () => {
    expect(fallbackDisplayName('/Users/chen/Code/spool')).toBe('spool')
    expect(fallbackDisplayName('/var/folders/scratch')).toBe('scratch')
  })
  it('handles trailing slash', () => {
    expect(fallbackDisplayName('/Users/chen/Code/spool/')).toBe('spool')
  })
  it('returns "(root)" for /', () => {
    expect(fallbackDisplayName('/')).toBe('(root)')
  })
  it('returns last segment of slash-bearing strings even non-paths', () => {
    expect(fallbackDisplayName('github.com/foo/bar')).toBe('bar')
  })
})

import { describe, it, expect } from 'vitest'
import { previewValueByKind } from './preview.js'

describe('previewValueByKind', () => {
  it('email reveals first char + full domain, masks the rest', () => {
    expect(previewValueByKind('maya@example.com', 'email')).toBe('m••@example.com')
    expect(previewValueByKind('j@gmail.com', 'email')).toBe('j••@gmail.com')
  })

  it('email without a domain yields no preview', () => {
    expect(previewValueByKind('maya@', 'email')).toBeNull()
    expect(previewValueByKind('@example.com', 'email')).toBeNull()
  })

  it('api-key shows vendor + last 4 when the prefix is known', () => {
    expect(previewValueByKind('sk_live_51HxyzABCDEFa39f', 'api-key')).toBe('Stripe ••a39f')
    expect(previewValueByKind('ghp_AbCdEfGhIjKlmnop', 'api-key')).toBe('GitHub ••mnop')
  })

  it('api-key with unknown vendor falls back to last 4 only', () => {
    expect(previewValueByKind('abcdefghijklmnop', 'api-key')).toBe('••mnop')
  })

  it('credit-card and ssn keep only the last 4 digits', () => {
    expect(previewValueByKind('4111 1111 1111 1111', 'credit-card')).toBe('•• 1111')
    expect(previewValueByKind('123-45-6789', 'ssn')).toBe('••-••-6789')
  })

  it('connection strings keep the public scheme, drop credentials', () => {
    expect(previewValueByKind('postgres://user:pass@host/db', 'connection-string')).toBe('postgres://••')
    expect(previewValueByKind('https://user:tok@api.example.com/x', 'url-creds')).toBe('https://••')
  })

  it('internal-host masks the host label but keeps the suffix', () => {
    expect(previewValueByKind('db01.internal.corp', 'internal-host')).toBe('••.internal.corp')
  })

  it('identity-tier kinds get no partial preview (kind label alone)', () => {
    expect(previewValueByKind('Maya Chen', 'person-name')).toBeNull()
    expect(previewValueByKind('555-123-4567', 'phone')).toBeNull()
    expect(previewValueByKind('192.168.0.1', 'ip')).toBeNull()
    expect(previewValueByKind('/Users/maya/secret', 'absolute-path')).toBeNull()
  })

  it('never reveals more than the last 4 chars of a credential — short values collapse', () => {
    // 7 chars < 2*4, so the tail would be a majority → suppressed.
    expect(previewValueByKind('abc1234', 'generic-secret')).toBeNull()
    // Even at the boundary the preview can only contain the last 4.
    const out = previewValueByKind('sk_live_0123456789abcdef', 'api-key')
    expect(out).toBe('Stripe ••cdef')
    expect(out).not.toContain('0123456789')
  })

  it('empty / whitespace input yields no preview', () => {
    expect(previewValueByKind('', 'email')).toBeNull()
    expect(previewValueByKind('   ', 'api-key')).toBeNull()
  })
})

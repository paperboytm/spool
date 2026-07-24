import { describe, expect, it } from 'vite-plus/test'

import { cacheHeaderFor, securityHeadersFor } from './security-headers'

describe('Explore security headers', () => {
  it('keeps public discovery indexable while applying the app CSP', () => {
    const headers = securityHeadersFor('/explore', 'nonce-value')

    expect(headers).not.toBeNull()
    expect(headers?.['X-Robots-Tag']).toBeUndefined()
    expect(headers?.['Content-Security-Policy']).toContain("script-src 'self' 'nonce-nonce-value'")
    expect(headers?.['Content-Security-Policy']).toContain("form-action 'self'")
    expect(headers?.['Content-Security-Policy']).toContain('https://spool.new')
    expect(headers?.['Content-Security-Policy']).toContain('https://spool.pro')
    expect(headers?.['Content-Security-Policy']).toContain('https://workoscdn.com')
    expect(headers?.['Content-Security-Policy']).toContain('https://images.workoscdn.com')
  })

  it('treats Team workspaces as authenticated app routes', () => {
    const headers = securityHeadersFor('/teams/team_123', 'nonce-1')

    expect(headers?.['Content-Security-Policy']).toContain("form-action 'self'")
    expect(headers?.['Content-Security-Policy']).toContain('https://images.workoscdn.com')
    expect(headers?.['X-Robots-Tag']).toBe('noindex')
    expect(cacheHeaderFor('/teams/team_123', 200)).toBe('private, no-store')
    expect(cacheHeaderFor('/teams', 200)).toBe('private, no-store')
    expect(cacheHeaderFor('/my-sessions', 200)).toBe('private, no-store')
  })

  it('never shares a Session reader document through a public cache', () => {
    expect(cacheHeaderFor('/session/codex_123', 200)).toBe('private, no-store')
    expect(cacheHeaderFor('/s/legacy-link', 200)).toContain('public')
  })
})

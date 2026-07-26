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

  it('keeps the public Sessions feed indexable with the app CSP', () => {
    for (const target of ['/sessions', '/sessions?sort=recent', '/sessions?scope=public']) {
      const headers = securityHeadersFor(target, 'sessions-public')

      expect(headers).not.toBeNull()
      expect(headers?.['X-Robots-Tag']).toBeUndefined()
      expect(headers?.['Content-Security-Policy']).toContain(
        "script-src 'self' 'nonce-sessions-public'",
      )
      expect(headers?.['Content-Security-Policy']).toContain("form-action 'self'")
      expect(cacheHeaderFor(target, 200)).toBeNull()
    }
  })

  it('keeps the public Projects directory indexable', () => {
    for (const target of ['/projects', '/projects?scope=public']) {
      const headers = securityHeadersFor(target, 'projects-public')

      expect(headers).not.toBeNull()
      expect(headers?.['X-Robots-Tag']).toBeUndefined()
      expect(headers?.['Content-Security-Policy']).toContain(
        "script-src 'self' 'nonce-projects-public'",
      )
    }
  })

  it('gives every owner route the strict Team-compatible document policy', () => {
    for (const target of ['/@evan', '/@evan/react-vapor', '/@paperboy/private-project']) {
      const headers = securityHeadersFor(target, 'owner-private')
      expect(headers?.['X-Robots-Tag']).toBe('noindex')
      expect(headers?.['Content-Security-Policy']).toContain(
        "script-src 'self' 'nonce-owner-private'",
      )
      expect(cacheHeaderFor(target, 200)).toBe('private, no-store')
    }
  })

  it('makes authenticated Sessions and Projects scopes non-indexable and private/no-store', () => {
    for (const target of [
      '/sessions?scope=mine',
      '/sessions?scope=team&team=team_123',
      // Repeated parameters must not let a public value weaken the policy.
      '/sessions?scope=public&scope=team&team=team_123',
      '/projects?scope=mine',
      '/projects?scope=team&team=team_123',
      '/projects?scope=public&scope=mine',
      '/projects/new',
      '/projects/project_123/edit',
    ]) {
      const headers = securityHeadersFor(new URL(target, 'https://spool.new'), 'sessions-private')

      expect(headers?.['X-Robots-Tag']).toBe('noindex')
      expect(headers?.['Content-Security-Policy']).toContain(
        "script-src 'self' 'nonce-sessions-private'",
      )
      expect(headers?.['Content-Security-Policy']).toContain("form-action 'self'")
      expect(cacheHeaderFor(new URL(target, 'https://spool.new'), 200)).toBe('private, no-store')
    }
  })

  it('never shares a Session reader document through a public cache', () => {
    expect(cacheHeaderFor('/session/codex_123', 200)).toBe('private, no-store')
    expect(cacheHeaderFor('/s/legacy-link', 200)).toContain('public')
  })
})

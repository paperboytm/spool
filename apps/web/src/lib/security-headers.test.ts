import { describe, expect, it } from 'vite-plus/test'

import { securityHeadersFor } from './security-headers'

describe('Explore security headers', () => {
  it('keeps public discovery indexable while applying the app CSP', () => {
    const headers = securityHeadersFor('/explore', 'nonce-value')

    expect(headers).not.toBeNull()
    expect(headers?.['X-Robots-Tag']).toBeUndefined()
    expect(headers?.['Content-Security-Policy']).toContain("script-src 'self' 'nonce-nonce-value'")
    expect(headers?.['Content-Security-Policy']).toContain("form-action 'self'")
  })
})

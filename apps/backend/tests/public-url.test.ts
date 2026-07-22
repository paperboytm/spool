import { describe, expect, it } from 'vite-plus/test'

import { oauthPublicBaseUrl, publicBaseUrl } from '../src/public-url'

describe('publicBaseUrl', () => {
  it('uses the local Web origin for the checked-in development environment', () => {
    expect(publicBaseUrl({ ENV: 'development' })).toBe('http://localhost:3002')
  })

  it('keeps explicit deployment origins and the production fallback', () => {
    expect(publicBaseUrl({ ENV: 'staging', PUBLIC_BASE_URL: 'https://staging.spool.new' })).toBe(
      'https://staging.spool.new',
    )
    expect(publicBaseUrl({ ENV: 'production' })).toBe('https://spool.new')
  })
})

describe('oauthPublicBaseUrl', () => {
  it.each(['spool.new', 'spool.pro'])(
    'keeps OAuth callbacks on the owned start host %s',
    (host) => {
      const request = new Request('https://spool-share-backend.pages.dev/api/auth/workos/start', {
        headers: { 'x-forwarded-host': host },
      })
      expect(oauthPublicBaseUrl(request, { PUBLIC_BASE_URL: 'https://spool.new' })).toBe(
        `https://${host}`,
      )
    },
  )

  it('ignores untrusted forwarded hosts and falls back to the configured origin', () => {
    const request = new Request('https://spool-share-backend.pages.dev/api/auth/workos/start', {
      headers: { 'x-forwarded-host': 'attacker.example' },
    })
    expect(oauthPublicBaseUrl(request, { PUBLIC_BASE_URL: 'https://spool.new' })).toBe(
      'https://spool.new',
    )
  })
})

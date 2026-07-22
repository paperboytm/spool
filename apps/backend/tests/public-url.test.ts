import { describe, expect, it } from 'vite-plus/test'

import { publicBaseUrl } from '../src/public-url'

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

import { describe, expect, it } from 'vite-plus/test'

import { apiOriginFor } from './server-api-origin'

describe('apiOriginFor', () => {
  it('normalizes the configured backend origin', () => {
    expect(apiOriginFor('https://spool-share-backend.pages.dev')).toBe(
      'https://spool-share-backend.pages.dev',
    )
    expect(apiOriginFor('http://localhost:8788/')).toBe('http://localhost:8788')
  })
})

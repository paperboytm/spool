import { describe, expect, it } from 'vite-plus/test'

import { resolveAvatarUrl, sharePublicOrigin, sharePublicUrl } from './sharePublicUrl'

describe('public share URL defaults', () => {
  it('uses spool.new for production links', () => {
    expect(sharePublicOrigin({})).toBe('https://spool.new')
    expect(sharePublicUrl('abc 123', {})).toBe('https://spool.new/s/abc%20123')
  })

  it('keeps explicit staging and backend origins', () => {
    const env = {
      VITE_SPOOL_SHARE_PUBLIC_URL: 'https://staging.spool.new/',
      VITE_SPOOL_SHARE_BACKEND: 'https://api.staging.example/',
    }
    expect(sharePublicOrigin(env)).toBe('https://staging.spool.new')
    expect(resolveAvatarUrl('/api/avatars/u1', env)).toBe(
      'https://api.staging.example/api/avatars/u1',
    )
  })
})

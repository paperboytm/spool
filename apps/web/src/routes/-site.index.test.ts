import { describe, expect, it, vi } from 'vite-plus/test'

import { hasFreshHomeSession } from './_site.index'

describe('homepage session redirect', () => {
  it('redirects only after a fresh authenticated /api/me response', async () => {
    const fetchCurrentMe = vi.fn(async () => ({ kind: 'ok' as const }))

    await expect(hasFreshHomeSession(fetchCurrentMe)).resolves.toBe(true)
    expect(fetchCurrentMe).toHaveBeenCalledOnce()
  })

  it.each(['unauthenticated', 'forbidden', 'error'] as const)(
    'stays on the homepage when /api/me returns %s',
    async (kind) => {
      await expect(hasFreshHomeSession(async () => ({ kind }))).resolves.toBe(false)
    },
  )
})

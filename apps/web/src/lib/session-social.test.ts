import { describe, expect, it, vi } from 'vite-plus/test'

import { fetchSessionSocial, sessionSocialUrl, updateSessionStar } from './session-social'

const social = {
  version: 1 as const,
  starCount: 12,
  forkCount: 3,
  viewerStarred: true,
  canStar: true,
}

describe('session social API', () => {
  it('encodes the sid and validates the public social payload', async () => {
    const fetcher = vi.fn(async () => Response.json(social))

    await expect(fetchSessionSocial('codex/a', fetcher)).resolves.toEqual({
      kind: 'ok',
      data: social,
    })
    expect(sessionSocialUrl('codex/a')).toBe('/api/discovery/v1/sessions/codex%2Fa/social')
    expect(fetcher).toHaveBeenCalledWith(
      '/api/discovery/v1/sessions/codex%2Fa/social',
      expect.objectContaining({ method: 'GET', credentials: 'same-origin' }),
    )
  })

  it.each([
    ['star', 'PUT'],
    ['unstar', 'DELETE'],
  ] as const)('maps %s to an idempotent %s request', async (intent, method) => {
    const fetcher = vi.fn(async () => Response.json(social))

    await expect(updateSessionStar('codex_12345678', intent, fetcher)).resolves.toEqual({
      kind: 'ok',
      data: social,
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/discovery/v1/sessions/codex_12345678/social',
      expect.objectContaining({ method }),
    )
  })

  it('rejects malformed counts and preserves auth/not-found states', async () => {
    await expect(
      fetchSessionSocial(
        'codex_12345678',
        vi.fn(async () => Response.json({ ...social, forkCount: -1 })),
      ),
    ).resolves.toEqual({ kind: 'error' })
    await expect(
      updateSessionStar(
        'codex_12345678',
        'star',
        vi.fn(async () => new Response(null, { status: 401 })),
      ),
    ).resolves.toEqual({ kind: 'unauthenticated' })
    await expect(
      fetchSessionSocial(
        'codex_12345678',
        vi.fn(async () => new Response(null, { status: 404 })),
      ),
    ).resolves.toEqual({ kind: 'not-found' })
  })
})

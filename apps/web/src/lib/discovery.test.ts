import type { DiscoverySessionsResponse } from '@spool-lab/session-kit'
import { describe, expect, it, vi } from 'vite-plus/test'

import {
  DiscoveryRequestError,
  discoverySessionsUrl,
  fetchDiscoverySessions,
  parseExploreSearch,
  postQualifiedRead,
} from './discovery'

const response: DiscoverySessionsResponse = {
  version: 1,
  items: [],
  nextCursor: 'opaque/next+cursor',
}

describe('Explore URL state', () => {
  it('normalizes query, sort, and agent without forwarding unknown values', () => {
    expect(
      parseExploreSearch({ q: '  refresh   races  ', sort: 'recent', agent: 'claude' }),
    ).toEqual({ q: 'refresh races', sort: 'recent', agent: 'claude' })
    expect(parseExploreSearch({ sort: 'popular', agent: 'gemini' })).toEqual({
      sort: 'recommended',
    })
  })

  it('uses Top instead of the retired Trending state with or without search', () => {
    expect(parseExploreSearch({ sort: 'trending' })).toEqual({
      sort: 'recommended',
    })
    expect(parseExploreSearch({ q: 'tokens', sort: 'trending' })).toEqual({
      q: 'tokens',
      sort: 'recommended',
    })
  })

  it('keeps opaque cursors intact and emits same-origin API URLs', () => {
    expect(
      discoverySessionsUrl({
        q: 'refresh race',
        sort: 'recent',
        agent: 'codex',
        cursor: 'opaque/next+cursor',
        limit: 20,
      }),
    ).toBe(
      '/api/discovery/v1/sessions?q=refresh+race&sort=recent&agent=codex&limit=20&cursor=opaque%2Fnext%2Bcursor',
    )
  })
})

describe('Explore API client', () => {
  it('imports and returns the shared discovery response shape', async () => {
    const controller = new AbortController()
    const fetcher = vi.fn(async () =>
      Response.json(response, { status: 200, headers: { 'content-type': 'application/json' } }),
    )

    await expect(
      fetchDiscoverySessions({ sort: 'recommended', signal: controller.signal }, fetcher),
    ).resolves.toEqual(response)
    expect(fetcher).toHaveBeenCalledWith(
      '/api/discovery/v1/sessions?sort=recommended&limit=20',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        signal: controller.signal,
      }),
    )
  })

  it('surfaces the repository error detail', async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: 'BAD_REQUEST', detail: 'Cursor does not match these filters.' },
        { status: 400 },
      ),
    )

    await expect(fetchDiscoverySessions({ sort: 'recent' }, fetcher)).rejects.toEqual(
      expect.objectContaining<Partial<DiscoveryRequestError>>({
        status: 400,
        message: 'Cursor does not match these filters.',
      }),
    )
  })

  it('replaces an opaque internal error with actionable Explore copy', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ error: 'INTERNAL', detail: 'unexpected' }, { status: 500 }),
    )

    await expect(fetchDiscoverySessions({ sort: 'recommended' }, fetcher)).rejects.toEqual(
      expect.objectContaining<Partial<DiscoveryRequestError>>({
        status: 500,
        message: 'Explore is temporarily unavailable. Try again in a moment.',
      }),
    )
  })

  it('posts the shared qualified-read payload to the Session endpoint', async () => {
    const fetcher = vi.fn(async () => Response.json({ accepted: false }))

    await expect(postQualifiedRead('claude_abc12345', fetcher)).resolves.toEqual({
      accepted: false,
    })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/discovery/v1/sessions/claude_abc12345/engagement',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ kind: 'qualified_read' }),
        keepalive: true,
      }),
    )
  })
})

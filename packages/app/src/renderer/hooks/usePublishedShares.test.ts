import { describe, expect, it } from 'vitest'
import { remoteToCacheItems, toCacheItem } from './usePublishedShares.js'
import type { MyShare } from '../../shared/share-publish.js'

const remote = (over: Partial<MyShare> = {}): MyShare => ({
  id: 'abc',
  title: 'Hello',
  visibility: 'unlisted',
  expires_at: null,
  version: 1,
  published_at: 1000,
  republished_at: null,
  revoked_at: null,
  draft_id: null,
  client_request_id: null,
  ...over,
})

describe('toCacheItem', () => {
  it('copies the wire fields and stamps updated_at to now', () => {
    const item = toCacheItem(remote({ id: 'x' }), 12345)
    expect(item).toEqual({
      id: 'x',
      title: 'Hello',
      visibility: 'unlisted',
      version: 1,
      published_at: 1000,
      revoked_at: null,
      expires_at: null,
      draft_id: null,
      client_request_id: null,
      updated_at: 12345,
    })
  })

  it('passes through client_request_id when present', () => {
    const item = toCacheItem(remote({ client_request_id: 'abcdef0123456789' }), 1)
    expect(item.client_request_id).toBe('abcdef0123456789')
  })

  it('passes through revoked_at and expires_at when present', () => {
    const item = toCacheItem(remote({ revoked_at: 5000, expires_at: 9000 }), 1)
    expect(item.revoked_at).toBe(5000)
    expect(item.expires_at).toBe(9000)
  })

  it('passes through draft_id when present', () => {
    const item = toCacheItem(remote({ draft_id: 'd-42' }), 1)
    expect(item.draft_id).toBe('d-42')
  })
})

describe('remoteToCacheItems', () => {
  it('returns one cache row per remote item', () => {
    const merged = remoteToCacheItems([remote({ id: 'a' }), remote({ id: 'b' })], 1)
    expect(merged.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('drops rows absent from remote (remote is the source of truth)', () => {
    const merged = remoteToCacheItems([remote({ id: 'fresh' })], 1)
    expect(merged.map((m) => m.id)).toEqual(['fresh'])
  })

  it('reflects revoked_at updates from the remote', () => {
    const merged = remoteToCacheItems([remote({ id: 'r', revoked_at: 42 })], 100)
    expect(merged[0]?.revoked_at).toBe(42)
    expect(merged[0]?.updated_at).toBe(100)
  })
})

// Asserts the cache side-effects baked into api.ts (`fetchMe` writes
// on 200, clears on 401; `signOut` always clears) AND the auth-promise
// memo invalidation that keeps the Header from painting a stale
// signed-in state after sign-out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchMe, signOut } from './api'
import { getCachedAuth, setCachedAuth } from './auth-cache'
import { readCachedMe, writeCachedMe } from './me-cache'

function makeStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => {
      data.delete(k)
    },
    setItem: (k, v) => {
      data.set(k, v)
    },
  }
}

function mockFetchOnce(status: number, body: unknown = {}): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

describe('api.ts cache side-effects', () => {
  let original: Storage | undefined
  beforeEach(() => {
    original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeStorage(),
      configurable: true,
    })
    // Reset the in-memory auth memo between tests so we observe the
    // intended state, not a leftover from a previous it().
    setCachedAuth(Promise.resolve('out'))
    setCachedAuth(null as unknown as Promise<never>) // wipe via re-set
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      })
    }
  })

  it('fetchMe 200 writes the public-identity slice into me-cache', async () => {
    mockFetchOnce(200, {
      id: 'u1',
      email: 'alice@example.com',
      name: 'Alice',
      avatar_url: 'https://x/a.png',
      handle: 'alice',
      deletion_pending_until: null,
    })
    const r = await fetchMe()
    expect(r.kind).toBe('ok')
    expect(readCachedMe()).toEqual({ name: 'Alice', avatar_url: 'https://x/a.png' })
  })

  it('fetchMe 401 clears the cache + invalidates the auth memo', async () => {
    // Seed both layers as if we were previously signed in.
    writeCachedMe({ name: 'Alice', avatar_url: 'x.png' })
    setCachedAuth(Promise.resolve({ name: 'Alice', src: 'x.png' }))

    mockFetchOnce(401, { error: 'UNAUTHENTICATED' })
    const r = await fetchMe()
    expect(r.kind).toBe('unauthenticated')
    expect(readCachedMe()).toBeNull()
    expect(getCachedAuth()).toBeNull()
  })

  it('fetchMe 403 (deletion pending) does NOT clear — user can still see the recovery surface', async () => {
    writeCachedMe({ name: 'Alice', avatar_url: 'x.png' })
    mockFetchOnce(403, { error: 'FORBIDDEN' })
    const r = await fetchMe()
    expect(r.kind).toBe('forbidden')
    expect(readCachedMe()).toEqual({ name: 'Alice', avatar_url: 'x.png' })
  })

  it('signOut clears me-cache + auth memo even when the network call fails', async () => {
    writeCachedMe({ name: 'Alice', avatar_url: 'x.png' })
    setCachedAuth(Promise.resolve({ name: 'Alice', src: 'x.png' }))
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))

    const ok = await signOut()
    expect(ok).toBe(false)
    expect(readCachedMe()).toBeNull()
    expect(getCachedAuth()).toBeNull()
  })

  it('signOut 200 also clears local state', async () => {
    writeCachedMe({ name: 'Alice', avatar_url: 'x.png' })
    setCachedAuth(Promise.resolve({ name: 'Alice', src: 'x.png' }))
    mockFetchOnce(200, { ok: true })

    const ok = await signOut()
    expect(ok).toBe(true)
    expect(readCachedMe()).toBeNull()
    expect(getCachedAuth()).toBeNull()
  })
})

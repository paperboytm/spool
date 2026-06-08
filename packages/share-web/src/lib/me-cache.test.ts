import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { clearCachedMe, readCachedMe, writeCachedMe } from './me-cache'

// Minimal localStorage shim — vitest's default test env is jsdom so a
// real Storage object exists, but we re-create it per test so write
// state from one assertion doesn't leak into the next.
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

const KEY = 'spool.share-web.me'

describe('me-cache', () => {
  let original: Storage | undefined
  beforeEach(() => {
    original = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeStorage(),
      configurable: true,
    })
  })
  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: original,
        configurable: true,
      })
    }
  })

  it('returns null when the cache is empty', () => {
    expect(readCachedMe()).toBeNull()
  })

  it('round-trips name + avatar_url through write/read', () => {
    writeCachedMe({ name: 'Alice', avatar_url: 'https://x/a.png' })
    expect(readCachedMe()).toEqual({ name: 'Alice', avatar_url: 'https://x/a.png' })
  })

  it('treats a foreign-version blob as a cache miss instead of returning bad data', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 999, name: 'Stale', avatar_url: null }))
    expect(readCachedMe()).toBeNull()
  })

  it('survives malformed JSON without throwing', () => {
    localStorage.setItem(KEY, '{not json')
    expect(readCachedMe()).toBeNull()
  })

  it('clearCachedMe removes the entry', () => {
    writeCachedMe({ name: 'Alice', avatar_url: null })
    clearCachedMe()
    expect(readCachedMe()).toBeNull()
  })

  it('readCachedMe returns null when localStorage is unavailable (private mode)', () => {
    // Throw on every access to simulate Safari private mode quota error.
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError')
      },
      configurable: true,
    })
    expect(readCachedMe()).toBeNull()
  })

  it('writeCachedMe is silent when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError')
      },
      configurable: true,
    })
    expect(() => writeCachedMe({ name: 'Alice', avatar_url: null })).not.toThrow()
  })

  it('preserves null name + null avatar_url through the round trip', () => {
    writeCachedMe({ name: null, avatar_url: null })
    expect(readCachedMe()).toEqual({ name: null, avatar_url: null })
  })
})

describe('me-cache vs api integration', () => {
  // The contract that matters: fetchMe writes on 200, clears on 401.
  // Direct API integration is covered in api.test.ts; this asserts
  // the cache primitive does what those side-effects expect.
  it('writeCachedMe followed by clearCachedMe leaves no residue', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeStorage(),
      configurable: true,
    })
    writeCachedMe({ name: 'Alice', avatar_url: 'x.png' })
    clearCachedMe()
    // Don't just trust readCachedMe — confirm via raw key absence too.
    expect(localStorage.getItem(KEY)).toBeNull()
  })

})

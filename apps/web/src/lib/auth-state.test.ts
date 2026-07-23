import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { fetchMe } from './api'
import { getCachedAuth, setCachedAuth } from './auth-cache'
import { resolveAuthState } from './auth-state'

function makeStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => Array.from(data.keys())[index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

function meBody(name: string) {
  return {
    id: 'user_1',
    email: 'alice@example.com',
    name,
    display_name: name,
    avatar_url: `https://example.com/${name}.png`,
    handle: 'alice',
    deletion_pending_until: null,
  }
}

describe('resolveAuthState', () => {
  let originalStorage: Storage | undefined

  beforeEach(() => {
    originalStorage = globalThis.localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      value: makeStorage(),
      configurable: true,
    })
    setCachedAuth(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setCachedAuth(null)
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        value: originalStorage,
        configurable: true,
      })
    }
  })

  it('does not memoize a transient failure as signed out', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(meBody('Alice')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    await expect(resolveAuthState()).resolves.toBe('out')
    expect(getCachedAuth()).toBeNull()
    await expect(resolveAuthState()).resolves.toEqual({
      name: 'Alice',
      src: 'https://example.com/Alice.png',
    })
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not let a late transient failure erase a concurrent success', async () => {
    let finishFirst: ((value: Response) => void) | undefined
    const first = new Promise<Response>((resolve) => {
      finishFirst = resolve
    })
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(
        new Response(JSON.stringify(meBody('Alice')), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )

    const headerRequest = resolveAuthState()
    await expect(fetchMe()).resolves.toMatchObject({ kind: 'ok' })
    finishFirst?.(new Response('{}', { status: 500 }))

    await expect(headerRequest).resolves.toEqual({
      name: 'Alice',
      src: 'https://example.com/Alice.png',
    })
    await expect(getCachedAuth()).resolves.toEqual({
      name: 'Alice',
      src: 'https://example.com/Alice.png',
    })
  })
})

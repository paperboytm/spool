import { describe, expect, it, vi } from 'vitest'

const directSessionFetch = vi.fn()

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  session: {
    fromPartition: vi.fn(() => ({
      setProxy: vi.fn(async () => undefined),
      fetch: (...args: unknown[]) => directSessionFetch(...args),
    })),
  },
}))

import {
  fetchOnce,
  isLoopbackUrl,
  isNetworkError,
  probeTransport,
  proxyRulesFromEnv,
  robustFetch,
  type Transport,
} from './robust-fetch.js'

function transport(label: string, impl: () => Promise<Response>): Transport {
  return { label, fetch: vi.fn(impl) as unknown as Transport['fetch'] }
}

const netErr = () => Object.assign(new Error('fetch failed'), {
  cause: new Error('connect ETIMEDOUT 142.250.0.1:443'),
})

describe('robustFetch', () => {
  it('returns the first transport result without touching the rest', async () => {
    const ok = new Response('hi', { status: 200 })
    const first = transport('a', async () => ok)
    const second = transport('b', async () => new Response('no'))
    const res = await robustFetch('https://x.test/', {}, [first, second])
    expect(res).toBe(ok)
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('falls through to the next transport on a network-level failure', async () => {
    const ok = new Response('hi', { status: 200 })
    const first = transport('a', async () => { throw netErr() })
    const second = transport('b', async () => ok)
    const res = await robustFetch('https://x.test/', {}, [first, second])
    expect(res).toBe(ok)
  })

  it('does NOT fall through on an HTTP error response — 4xx resolves normally', async () => {
    // fetch resolves (not rejects) on HTTP errors; a 400 from the OAuth
    // endpoint must reach the caller, not trigger a code-double-spend
    // retry on another transport.
    const bad = new Response('invalid_grant', { status: 400 })
    const first = transport('a', async () => bad)
    const second = transport('b', async () => new Response('never'))
    const res = await robustFetch('https://x.test/', {}, [first, second])
    expect(res.status).toBe(400)
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('rethrows non-network errors immediately', async () => {
    const first = transport('a', async () => { throw new TypeError('body used already') })
    const second = transport('b', async () => new Response('never'))
    await expect(robustFetch('https://x.test/', {}, [first, second]))
      .rejects.toThrow('body used already')
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('throws the last network error when every transport fails', async () => {
    const first = transport('a', async () => { throw netErr() })
    const last = Object.assign(new Error('fetch failed'), { cause: new Error('net::ERR_CONNECTION_REFUSED') })
    const second = transport('b', async () => { throw last })
    await expect(robustFetch('https://x.test/', {}, [first, second]))
      .rejects.toBe(last)
  })
})

describe('fetchOnce', () => {
  it('probes with a GET, then sends the real request exactly once on the winner', async () => {
    const calls: { url: string; method?: string }[] = []
    const dead = transport('dead', async () => { throw netErr() })
    const alive: Transport = {
      label: 'alive',
      fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init?.method !== undefined && { method: init.method }) })
        return new Response('ok', { status: init?.method === 'POST' ? 200 : 404 })
      }) as unknown as Transport['fetch'],
    }
    const res = await fetchOnce(
      'https://api.test/token',
      { method: 'POST', body: 'code=once' },
      [dead, alive],
    )
    expect(res.status).toBe(200)
    // dead transport saw only the probe; the POST went out once, on alive.
    expect(dead.fetch).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      { url: 'https://api.test/', method: 'GET' },
      { url: 'https://api.test/token', method: 'POST' },
    ])
  })

  it('a probe 4xx still selects the transport — status is irrelevant to reachability', async () => {
    const t = transport('a', async () => new Response('nope', { status: 403 }))
    const picked = await probeTransport('https://api.test/token', [t])
    expect(picked).toBe(t)
  })

  it('does NOT retry the real request on another transport after the probe commits', async () => {
    let probed = false
    const flaky: Transport = {
      label: 'flaky',
      fetch: vi.fn(async () => {
        if (!probed) { probed = true; return new Response('probe ok') }
        throw netErr() // the committed POST dies mid-flight
      }) as unknown as Transport['fetch'],
    }
    const second = transport('never', async () => new Response('never'))
    await expect(fetchOnce('https://api.test/token', { method: 'POST' }, [flaky, second]))
      .rejects.toThrow('fetch failed')
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('throws when every probe fails', async () => {
    const a = transport('a', async () => { throw netErr() })
    const b = transport('b', async () => { throw netErr() })
    await expect(fetchOnce('https://api.test/x', {}, [a, b])).rejects.toThrow('fetch failed')
  })
})

describe('loopback handling', () => {
  it.each(['http://localhost:8788/api', 'http://127.0.0.1:3002/', 'http://[::1]:8080/x'])(
    '%s is loopback',
    (url) => expect(isLoopbackUrl(url)).toBe(true),
  )

  it('public hosts are not loopback', () => {
    expect(isLoopbackUrl('https://spool.pro/api')).toBe(false)
  })

  it('loopback targets skip the provided chain and go direct', async () => {
    directSessionFetch.mockResolvedValue(new Response('local ok'))
    const proxyish = transport('system', async () => new Response('via proxy'))
    const res = await robustFetch('http://localhost:8788/api/health', {}, [proxyish])
    expect(await res.text()).toBe('local ok')
    expect(proxyish.fetch).not.toHaveBeenCalled()
  })
})

describe('proxyRulesFromEnv', () => {
  it('maps an http proxy URL to host:port rules', () => {
    expect(proxyRulesFromEnv({ https_proxy: 'http://127.0.0.1:7897' })).toBe('127.0.0.1:7897')
  })

  it('maps a socks proxy to socks5 rules', () => {
    expect(proxyRulesFromEnv({ all_proxy: 'socks5://127.0.0.1:7897' })).toBe('socks5://127.0.0.1:7897')
  })

  it('prefers https_proxy over all_proxy and uppercase variants', () => {
    expect(proxyRulesFromEnv({
      ALL_PROXY: 'socks5://1.1.1.1:1080',
      https_proxy: 'http://2.2.2.2:8080',
    })).toBe('2.2.2.2:8080')
  })

  it('returns null when unset or unparseable', () => {
    expect(proxyRulesFromEnv({})).toBeNull()
    expect(proxyRulesFromEnv({ https_proxy: 'not a url' })).toBeNull()
    expect(proxyRulesFromEnv({ https_proxy: 'http://127.0.0.1' })).toBeNull()
  })
})

describe('isNetworkError', () => {
  it.each([
    ['undici fetch failed with cause', netErr()],
    ['chromium net error', new Error('net::ERR_PROXY_CONNECTION_FAILED')],
    ['timeout abort', Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })],
  ])('%s → true', (_name, err) => {
    expect(isNetworkError(err)).toBe(true)
  })

  it('programming errors → false', () => {
    expect(isNetworkError(new TypeError('x is not a function'))).toBe(false)
    expect(isNetworkError('string')).toBe(false)
  })
})

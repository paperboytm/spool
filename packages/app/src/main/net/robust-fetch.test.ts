import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  session: { fromPartition: vi.fn() },
}))

import { isNetworkError, proxyRulesFromEnv, robustFetch, type Transport } from './robust-fetch.js'

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

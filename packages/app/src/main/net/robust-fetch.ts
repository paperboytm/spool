// Proxy-resilient fetch for main-process calls that must reach the
// outside internet (OAuth token exchange, prod backend). One transport
// is never right for every user (bug_electron_proxy):
//
//   - undici (globalThis.fetch) ignores proxies entirely
//   - net.fetch follows the OS proxy, but a stale/broken system-proxy
//     config takes working direct connectivity down with it, and one
//     observed loopback-proxy setup (mihomo on 127.0.0.1 as macOS
//     system proxy) fails through net.fetch while the proxy itself is
//     healthy
//   - dev shells often carry https_proxy env vars that neither of the
//     above consult
//
// So: try transports in order, falling through ONLY on network-level
// failures (connect timeout / refused / net::ERR_*). HTTP responses —
// including 4xx/5xx — resolve normally and never trigger a retry, so a
// single-use OAuth code can't be double-spent across transports.
//
//   1. net.fetch          — OS proxy when configured, direct otherwise
//   2. env-proxy session  — https_proxy/all_proxy env, when present
//   3. direct session     — forced direct, rescues a broken proxy config
//
// Every transport goes through Chromium's network stack (net.fetch /
// ses.fetch), so the OS trust store applies uniformly and no proxy
// dependency is bundled.

import { net, session } from 'electron'

const ATTEMPT_TIMEOUT_MS = 8_000

/** Map the conventional proxy env vars to Chromium proxyRules syntax.
 *  Returns null when no usable proxy env is set. Exported for tests. */
export function proxyRulesFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const raw =
    env['https_proxy'] ??
    env['HTTPS_PROXY'] ??
    env['http_proxy'] ??
    env['HTTP_PROXY'] ??
    env['all_proxy'] ??
    env['ALL_PROXY']
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (!u.hostname || !u.port) return null
    return u.protocol.startsWith('socks')
      ? `socks5://${u.hostname}:${u.port}`
      : `${u.hostname}:${u.port}`
  } catch {
    return null
  }
}

/** Network-level failure (request never completed) vs everything else.
 *  Only the former is safe grounds to retry on another transport.
 *  Exported for tests. */
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  const text = e.message + (e.cause instanceof Error ? ` ${e.cause.message}` : '')
  return /fetch failed|net::ERR_|ECONNREFUSED|ECONNRESET|ETIMEDOUT|UND_ERR_/i.test(text)
}

export interface Transport {
  label: string
  fetch: typeof globalThis.fetch
}

function sessionTransport(partition: string, config: Electron.ProxyConfig): Transport['fetch'] {
  return async (url, init) => {
    const ses = session.fromPartition(partition)
    await ses.setProxy(config)
    return ses.fetch(url as string, init as RequestInit)
  }
}

export function defaultTransports(): Transport[] {
  const transports: Transport[] = [
    {
      label: 'system',
      fetch: (url, init) => net.fetch(url as string, init as RequestInit),
    },
  ]
  const envRules = proxyRulesFromEnv()
  if (envRules) {
    transports.push({
      label: `env-proxy ${envRules}`,
      // <local> keeps loopback targets (dev backend) off the proxy.
      fetch: sessionTransport('spool-net-env-proxy', {
        proxyRules: envRules,
        proxyBypassRules: '<local>',
      }),
    })
  }
  transports.push({
    label: 'direct',
    fetch: sessionTransport('spool-net-direct', { mode: 'direct' }),
  })
  return transports
}

/**
 * Fetch through the transport chain. `init.body` must be replayable
 * (string / URLSearchParams / FormData — not a stream), since a later
 * transport re-sends it.
 */
export async function robustFetch(
  url: string,
  init: RequestInit = {},
  transports: Transport[] = defaultTransports(),
): Promise<Response> {
  let lastError: unknown
  for (const transport of transports) {
    try {
      return await transport.fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      })
    } catch (e) {
      if (!isNetworkError(e)) throw e
      lastError = e
      console.warn(
        `[robust-fetch] ${transport.label} transport failed for ${new URL(url).host}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }
  throw lastError
}

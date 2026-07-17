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
// including 4xx/5xx — resolve normally and never trigger a retry.
//
//   1. net.fetch          — OS proxy when configured, direct otherwise
//   2. env-proxy session  — https_proxy/all_proxy env, when present
//   3. direct session     — forced direct, rescues a broken proxy config
//
// Every transport goes through Chromium's network stack (net.fetch /
// ses.fetch), so the OS trust store applies uniformly and no proxy
// dependency is bundled.
//
// Two hard-won rules on top of the chain:
//
// - Loopback targets NEVER go through a proxy transport. A local
//   proxy will happily accept a CONNECT to localhost and then sit on
//   it — observed live: the dev backend received the sign-in POST
//   through the system proxy, but the response never came back.
//
// - A request whose effect can't be replayed (one-shot OAuth code,
//   anti-replay nonce) must NOT be blindly re-sent on the next
//   transport: "delivered but response lost" is indistinguishable
//   from "never delivered" at the connect level, and the retry burned
//   a nonce that the server had already consumed (403 nonce replay).
//   Use fetchOnce() for those: it picks a working transport with a
//   side-effect-free GET probe first, then sends the real request
//   exactly once.

import { net, session } from 'electron'

const PROBE_TIMEOUT_MS = 6_000
// The committed request gets a generous window — a slow-but-alive
// response must not be misread as a dead transport once side effects
// may already exist on the server.
const REQUEST_TIMEOUT_MS = 30_000

/** Loopback targets must never touch a proxy — see the header note. */
export function isLoopbackUrl(url: string): boolean {
  const host = new URL(url).hostname
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

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

const directTransport: Transport = {
  label: 'direct',
  fetch: sessionTransport('spool-net-direct', { mode: 'direct' }),
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
      // <local> keeps loopback targets off the proxy even here.
      fetch: sessionTransport('spool-net-env-proxy', {
        proxyRules: envRules,
        proxyBypassRules: '<local>',
      }),
    })
  }
  transports.push(directTransport)
  return transports
}

function transportsFor(url: string, transports: Transport[]): Transport[] {
  return isLoopbackUrl(url) ? [directTransport] : transports
}

/**
 * Fetch through the transport chain, falling through on network-level
 * failures. ONLY for requests that are safe to replay (idempotent GETs,
 * retriable POSTs): a transport that delivered the request but lost
 * the response still falls through, re-sending the body.
 */
export async function robustFetch(
  url: string,
  init: RequestInit = {},
  transports: Transport[] = defaultTransports(),
): Promise<Response> {
  let lastError: unknown
  for (const transport of transportsFor(url, transports)) {
    try {
      return await transport.fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(PROBE_TIMEOUT_MS),
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

/**
 * Transport selection for non-replayable requests: GET the target's
 * origin through the chain and return the first transport that yields
 * ANY HTTP response (status is irrelevant — a 404 proves the path
 * works). The probe carries no side effects, so falling through here
 * is always safe.
 */
export async function probeTransport(
  targetUrl: string,
  transports: Transport[] = defaultTransports(),
): Promise<Transport> {
  const probeUrl = new URL('/', targetUrl).toString()
  let lastError: unknown
  for (const transport of transportsFor(targetUrl, transports)) {
    try {
      await transport.fetch(probeUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      return transport
    } catch (e) {
      if (!isNetworkError(e)) throw e
      lastError = e
      console.warn(
        `[robust-fetch] probe via ${transport.label} failed for ${new URL(probeUrl).host}:`,
        e instanceof Error ? e.message : e,
      )
    }
  }
  throw lastError
}

/**
 * Send a request whose effect must not be duplicated (one-shot OAuth
 * code, anti-replay nonce): pick a transport with a side-effect-free
 * probe, then send the real request EXACTLY ONCE on it. A failure
 * after that propagates — never retried, because the server may
 * already have consumed the side effect.
 */
export async function fetchOnce(
  url: string,
  init: RequestInit = {},
  transports: Transport[] = defaultTransports(),
): Promise<Response> {
  const transport = await probeTransport(url, transports)
  return transport.fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

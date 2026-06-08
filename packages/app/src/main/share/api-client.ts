import { net } from 'electron'

import { loadToken } from '../auth/session-store.js'

import { backendUrl } from './backend-url.js'

// Electron's `net.fetch` honours macOS system proxy and the OS trust
// store; the global `fetch` (undici in main) bypasses both. See
// bug_electron_proxy — same fix as the PF model download path in
// main/index.ts. Injectable so tests can swap in a deterministic stub
// without touching the real network.
const defaultFetch: typeof globalThis.fetch = (url, init) =>
  net.fetch(url as string, init as RequestInit)

export async function authedFetch(
  path: string,
  init: RequestInit = {},
  fetchFn: typeof globalThis.fetch = defaultFetch,
): Promise<Response> {
  const token = loadToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  // Default to JSON only when the body is plain — for FormData we have
  // to let the runtime set `multipart/form-data; boundary=…` itself,
  // otherwise the backend can't parse the parts.
  if (!headers.has('content-type') && init.body && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json')
  }
  return fetchFn(`${backendUrl()}${path}`, { ...init, headers })
}

import { loadToken } from '../auth/session-store.js'

function backend(): string {
  return process.env['SPOOL_SHARE_BACKEND'] ?? 'https://spool.share'
}

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = loadToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json')
  return fetch(`${backend()}${path}`, { ...init, headers })
}

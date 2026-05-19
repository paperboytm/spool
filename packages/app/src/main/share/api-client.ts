import { loadToken } from '../auth/session-store.js'

import { backendUrl } from './backend-url.js'

export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = loadToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  if (!headers.has('content-type') && init.body) headers.set('content-type', 'application/json')
  return fetch(`${backendUrl()}${path}`, { ...init, headers })
}

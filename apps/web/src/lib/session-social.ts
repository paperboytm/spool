import type { DiscoverySessionSocialResponse } from '@spool-lab/session-kit'

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

export type SessionSocialResult =
  | { kind: 'ok'; data: DiscoverySessionSocialResponse }
  | { kind: 'unauthenticated' }
  | { kind: 'not-found' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export type SessionStarIntent = 'star' | 'unstar'

export function sessionSocialUrl(sid: string): string {
  return `/api/discovery/v1/sessions/${encodeURIComponent(sid)}/social`
}

export async function fetchSessionSocial(
  sid: string,
  fetcher: FetchLike = fetch,
  signal?: AbortSignal,
): Promise<SessionSocialResult> {
  return requestSessionSocial(sid, 'GET', fetcher, signal)
}

export async function updateSessionStar(
  sid: string,
  intent: SessionStarIntent,
  fetcher: FetchLike = fetch,
): Promise<SessionSocialResult> {
  return requestSessionSocial(sid, intent === 'star' ? 'PUT' : 'DELETE', fetcher)
}

async function requestSessionSocial(
  sid: string,
  method: 'GET' | 'PUT' | 'DELETE',
  fetcher: FetchLike,
  signal?: AbortSignal,
): Promise<SessionSocialResult> {
  try {
    const response = await fetcher(sessionSocialUrl(sid), {
      method,
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      ...(signal ? { signal } : {}),
    })
    if (response.status === 401) return { kind: 'unauthenticated' }
    if (response.status === 403) return { kind: 'forbidden' }
    if (response.status === 404) return { kind: 'not-found' }
    if (!response.ok) return { kind: 'error' }

    const body: unknown = await response.json()
    return isSocialResponse(body) ? { kind: 'ok', data: body } : { kind: 'error' }
  } catch (error) {
    if (signal?.aborted && error instanceof DOMException && error.name === 'AbortError') {
      return { kind: 'error' }
    }
    return { kind: 'error' }
  }
}

function isSocialResponse(value: unknown): value is DiscoverySessionSocialResponse {
  if (value === null || typeof value !== 'object') return false
  const response = value as Partial<DiscoverySessionSocialResponse>
  return (
    response.version === 1 &&
    Number.isSafeInteger(response.starCount) &&
    (response.starCount ?? -1) >= 0 &&
    Number.isSafeInteger(response.forkCount) &&
    (response.forkCount ?? -1) >= 0 &&
    typeof response.viewerStarred === 'boolean' &&
    typeof response.canStar === 'boolean'
  )
}

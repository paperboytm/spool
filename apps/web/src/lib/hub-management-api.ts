import type { SessionSummaries, SessionTitles } from '@spool-lab/session-kit'

export type ManagedSessionVisibility = 'public' | 'link-only' | 'team'

export interface ManagedSessionAuthor {
  handle: string | null
  display_name: string | null
  avatar_url: string | null
}

export interface ManagedSessionProject {
  id: string
  slug: string
  name: string
  owner: {
    kind: 'user' | 'team'
    id: string
    handle: string
    name: string
  }
}

export interface ManagedSession {
  sid: string
  title: string
  titles?: SessionTitles | null
  summary: string | null
  summaries?: SessionSummaries | null
  cost?: { usd: number | null; totalTokens: number } | null
  star_count?: number
  provider: string
  created_at: number
  /** Discovery publication time. Null for Link-only and Team-only Sessions. */
  published_at?: number | null
  updated_at: number
  visibility: ManagedSessionVisibility
  team_id: string | null
  team_name: string | null
  /** Required by current Hub responses; optional only during a rolling upgrade. */
  project?: ManagedSessionProject
  can_manage_visibility: boolean
  author: ManagedSessionAuthor
}

export interface ManagedSessionPage {
  sessions: ManagedSession[]
  /** Total Sessions in the scope, independent of the current page. */
  session_count?: number
  next_cursor: string | null
}

export type HubManagementFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; detail?: string }
  | { kind: 'not-found' }
  | { kind: 'gone'; detail?: string }
  | { kind: 'conflict'; detail?: string }
  | { kind: 'invalid'; detail?: string }
  | { kind: 'rate-limited' }
  | { kind: 'error'; detail?: string }

export type HubManagementResult<T> = { kind: 'ok'; data: T } | HubManagementFailure

interface ErrorBody {
  detail?: string
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<HubManagementResult<T>> {
  try {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
    })
    if (response.ok) {
      return { kind: 'ok', data: (await response.json()) as T }
    }

    const body = (await response.json().catch(() => ({}))) as ErrorBody
    const detail = body.detail
    if (response.status === 401) return { kind: 'unauthenticated' }
    if (response.status === 403) return { kind: 'forbidden', ...(detail ? { detail } : {}) }
    if (response.status === 404) return { kind: 'not-found' }
    if (response.status === 410) return { kind: 'gone', ...(detail ? { detail } : {}) }
    if (response.status === 409) return { kind: 'conflict', ...(detail ? { detail } : {}) }
    if (response.status === 400 || response.status === 422) {
      return { kind: 'invalid', ...(detail ? { detail } : {}) }
    }
    if (response.status === 429) return { kind: 'rate-limited' }
    // Keep internal Hub/upstream diagnostics out of account and Team UI copy.
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

export function fetchMySessions(
  cursor: string | null = null,
): Promise<HubManagementResult<ManagedSessionPage>> {
  const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
  return requestJson(`/api/me/sessions${query}`)
}

export function appendUniqueManagedSessions(
  current: readonly ManagedSession[],
  incoming: readonly ManagedSession[],
): ManagedSession[] {
  const seen = new Set(current.map((session) => session.sid))
  const merged = [...current]
  for (const session of incoming) {
    if (seen.has(session.sid)) continue
    seen.add(session.sid)
    merged.push(session)
  }
  return merged
}

export function updateManagedSessionVisibility(
  sid: string,
  visibility: ManagedSessionVisibility,
  options: {
    teamId?: string
    projectId?: string
    expectedProjectId?: string
  } = {},
): Promise<HubManagementResult<{ session: ManagedSession }>> {
  return requestJson(`/api/me/sessions/${encodeURIComponent(sid)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      visibility,
      ...(visibility === 'team' && options.teamId ? { team_id: options.teamId } : {}),
      ...(options.projectId ? { project_id: options.projectId } : {}),
      ...(options.expectedProjectId ? { expected_project_id: options.expectedProjectId } : {}),
    }),
  })
}

export function withdrawManagedSession(
  sid: string,
): Promise<HubManagementResult<{ withdrawn: true }>> {
  return requestJson(`/api/hub/v1/sessions/${encodeURIComponent(sid)}/withdraw`, {
    method: 'POST',
  })
}

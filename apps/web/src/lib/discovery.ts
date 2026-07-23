import type {
  DiscoveryEngagementRequest,
  DiscoveryEngagementResponse,
  DiscoverySessionItem,
  DiscoverySessionsResponse,
  DiscoverySort,
} from '@spool-lab/session-kit'

export type DiscoveryAgentFilter = DiscoverySessionItem['agent']
export type ExploreSort = Exclude<DiscoverySort, 'trending'>

export interface ExploreSearchState {
  q?: string
  sort: ExploreSort
  agent?: DiscoveryAgentFilter
}

export interface DiscoveryRequestOptions {
  q?: string
  sort: DiscoverySort
  agent?: DiscoveryAgentFilter
  cursor?: string | null
  limit?: number
  signal?: AbortSignal
}

interface FetchLike {
  (input: string | URL | Request, init?: RequestInit): Promise<Response>
}

export class DiscoveryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DiscoveryRequestError'
  }
}

function cleanQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const query = value.trim().replace(/\s+/g, ' ')
  return query === '' ? undefined : query.slice(0, 120)
}

export function parseExploreSearch(search: Record<string, unknown>): ExploreSearchState {
  const q = cleanQuery(search['q'])
  const sortValue = search['sort']
  // Trending remains accepted by the v1 API for old clients, but the public
  // product exposes one global quality order (Top) and one time order
  // (Recent). Old Trending URLs therefore settle safely on Top.
  const sort: ExploreSort = sortValue === 'recent' ? 'recent' : 'recommended'
  const agentValue = search['agent']
  const agent = agentValue === 'claude' || agentValue === 'codex' ? agentValue : undefined

  return {
    ...(q ? { q } : {}),
    sort,
    ...(agent ? { agent } : {}),
  }
}

export function discoverySessionsUrl(options: DiscoveryRequestOptions): string {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  params.set('sort', options.sort)
  if (options.agent) params.set('agent', options.agent)
  params.set('limit', String(options.limit ?? 20))
  if (options.cursor) params.set('cursor', options.cursor)
  return `/api/discovery/v1/sessions?${params.toString()}`
}

function isDiscoveryResponse(value: unknown): value is DiscoverySessionsResponse {
  if (typeof value !== 'object' || value === null) return false
  const response = value as Partial<DiscoverySessionsResponse>
  return (
    response.version === 1 &&
    Array.isArray(response.items) &&
    (typeof response.nextCursor === 'string' || response.nextCursor === null)
  )
}

async function responseDetail(response: Response): Promise<string> {
  if (response.status >= 500) {
    return 'Explore is temporarily unavailable. Try again in a moment.'
  }

  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null
  return typeof body?.detail === 'string' && body.detail.trim() !== ''
    ? body.detail
    : `Explore request failed with HTTP ${response.status}.`
}

export async function fetchDiscoverySessions(
  options: DiscoveryRequestOptions,
  fetcher: FetchLike = fetch,
): Promise<DiscoverySessionsResponse> {
  const response = await fetcher(discoverySessionsUrl(options), {
    headers: { accept: 'application/json' },
    ...(options.signal ? { signal: options.signal } : {}),
  })
  if (!response.ok) {
    throw new DiscoveryRequestError(await responseDetail(response), response.status)
  }

  const body: unknown = await response.json()
  if (!isDiscoveryResponse(body)) {
    throw new DiscoveryRequestError('Explore returned an invalid response.', response.status)
  }
  return body
}

export async function postQualifiedRead(
  sid: string,
  fetcher: FetchLike = fetch,
): Promise<DiscoveryEngagementResponse | null> {
  const request: DiscoveryEngagementRequest = { kind: 'qualified_read' }
  try {
    const response = await fetcher(
      `/api/discovery/v1/sessions/${encodeURIComponent(sid)}/engagement`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        keepalive: true,
      },
    )
    if (!response.ok) return null
    const body = (await response.json()) as Partial<DiscoveryEngagementResponse>
    return typeof body.accepted === 'boolean' ? { accepted: body.accepted } : null
  } catch {
    return null
  }
}

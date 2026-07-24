export type HubFetch = typeof globalThis.fetch

export interface HubClientOptions {
  hubUrl: string
  token?: string
  fetch?: HubFetch
}

export interface HubSessionWriteRequest {
  root: string
  count: number
  manifest: string[]
  sig: null
  cardJson: string | null
  summaryMd: string | null
  lineageJson: string | null
  viewOid: string
  /** Optional curated .spool document attached to the share. */
  spoolFileOid: string | null
  /** Explicit disclosure target. Omitted to preserve the Hub's provider-aware default. */
  visibility?: 'public' | 'link-only' | 'team'
  /** Required alongside `visibility: 'team'`; never inferred from UI navigation state. */
  teamId?: string
  /** Optional optimistic tenant precondition; null means personal/new. */
  expectedTeamId?: string | null
}

export interface HubPushResponse {
  missing: string[]
}

export interface HubObjectUpload {
  oid: string
  data: string
}

export interface HubObjectBatchResponse {
  stored: number
  duplicate?: number
}

export interface HubHeadResponse {
  url: string
}

export interface HubAuthor {
  handle: string | null
  displayName: string | null
  avatarUrl: string | null
}

export interface HubSessionMeta {
  sid: string
  root: string
  count: number
  sig: string | null
  cardJson: string | null
  summaryMd: string | null
  lineageJson: string | null
  viewOid: string
  spoolFileOid?: string | null
  createdAt: number
  updatedAt: number
  visibility?: 'public' | 'link-only' | 'team'
  /** Durable workspace owner, independent of the current disclosure level. */
  team?: { id: string; name: string } | null
  author: HubAuthor
}

export interface HubTokenResponse {
  token: string
}

export interface HubCliAuthStartResponse {
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
  interval: number
}

export interface HubCliAuthPollResponse {
  status: 'pending' | 'approved'
  token?: string
  interval?: number
}

export interface HubTeam {
  id: string
  name: string
  role: 'owner' | 'admin' | 'member'
  permissions: string[]
  member_count: number
  archived_at: number | null
}

/** Management row returned by disclosure changes. */
export interface HubManagedSession {
  sid: string
  visibility: 'public' | 'link-only' | 'team'
  team_id: string | null
  team_name: string | null
}

export interface HubRecord {
  i: number
  oid: string
  data: string
}

export interface HubRecordRange {
  from: number
  to: number
}

export class HubHttpError extends Error {
  readonly status: number
  readonly bodyMessage: string

  constructor(status: number, bodyMessage: string) {
    super(`Hub request failed with HTTP ${status}: ${bodyMessage}`)
    this.name = 'HubHttpError'
    this.status = status
    this.bodyMessage = bodyMessage
  }
}

export class HubClient {
  private readonly hubUrl: string
  private readonly token: string | undefined
  private readonly fetchImpl: HubFetch

  constructor(options: HubClientOptions) {
    this.hubUrl = normalizeHubUrl(options.hubUrl)
    this.token = options.token
    this.fetchImpl = options.fetch ?? globalThis.fetch
  }

  pushSession(sid: string, body: HubSessionWriteRequest): Promise<HubPushResponse> {
    return this.postJson(
      `/api/hub/v1/sessions/${encodeURIComponent(sid)}/push`,
      withLegacySummaryAlias(body),
    )
  }

  uploadObjects(objects: Iterable<HubObjectUpload>): Promise<HubObjectBatchResponse> {
    const body = Array.from(objects, (object) => JSON.stringify(object)).join('\n')
    return this.postNdjson('/api/hub/v1/objects/batch', body === '' ? body : `${body}\n`)
  }

  commitSessionHead(sid: string, body: HubSessionWriteRequest): Promise<HubHeadResponse> {
    return this.postJson(
      `/api/hub/v1/sessions/${encodeURIComponent(sid)}/head`,
      withLegacySummaryAlias(body),
    )
  }

  async withdrawSession(sid: string): Promise<void> {
    await this.postJson(`/api/hub/v1/sessions/${encodeURIComponent(sid)}/withdraw`, undefined)
  }

  createToken(): Promise<HubTokenResponse> {
    return this.postJson('/api/hub/v1/tokens', undefined)
  }

  /** Revoke the token this client authenticates with (`spool logout`). */
  async revokeToken(): Promise<void> {
    await this.request('/api/hub/v1/tokens', { method: 'DELETE' })
  }

  // Both cli-auth calls are deliberately unauthenticated — they run
  // before the CLI holds any credential.
  startCliAuth(label: string | null): Promise<HubCliAuthStartResponse> {
    return this.postJson('/api/cli-auth/start', label === null ? undefined : { label })
  }

  pollCliAuth(deviceCode: string): Promise<HubCliAuthPollResponse> {
    return this.postJson('/api/cli-auth/poll', { device_code: deviceCode })
  }

  async getSession(sid: string): Promise<HubSessionMeta> {
    const { noteMd, ...meta } = await this.getJson<
      HubSessionMeta & { summaryMd?: string | null; noteMd?: string | null }
    >(`/api/hub/v1/sessions/${encodeURIComponent(sid)}`)
    return {
      ...meta,
      summaryMd: meta.summaryMd ?? noteMd ?? null,
    }
  }

  /** Teams the authenticated user belongs to (hub-token authenticated). */
  async listTeams(): Promise<HubTeam[]> {
    return (await this.getJson<{ teams: HubTeam[] }>('/api/hub/v1/teams')).teams
  }

  /** Change a published Session's disclosure without re-pushing records. */
  async updateSessionVisibility(
    sid: string,
    visibility: 'public' | 'link-only' | 'team',
    teamId?: string,
  ): Promise<HubManagedSession> {
    const response = await this.request(`/api/me/sessions/${encodeURIComponent(sid)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visibility,
        ...(teamId === undefined ? {} : { team_id: teamId }),
      }),
    })
    return (await parseJsonResponse<{ session: HubManagedSession }>(response)).session
  }

  getSessionView<TView = unknown>(sid: string): Promise<TView> {
    return this.getJson(`/api/hub/v1/sessions/${encodeURIComponent(sid)}/view`)
  }

  getSessionRecords(sid: string, range: HubRecordRange): AsyncGenerator<HubRecord> {
    const query = new URLSearchParams({
      from: String(range.from),
      to: String(range.to),
    })
    return this.getNdjson(
      `/api/hub/v1/sessions/${encodeURIComponent(sid)}/records?${query.toString()}`,
    )
  }

  async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: 'GET' })
    return parseJsonResponse<T>(response)
  }

  async postJson<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return parseJsonResponse<T>(response)
  }

  async postNdjson<T>(path: string, body: string): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    })
    return parseJsonResponse<T>(response)
  }

  async *getNdjson<T>(path: string): AsyncGenerator<T> {
    const response = await this.request(path, {
      method: 'GET',
      headers: { Accept: 'application/x-ndjson' },
    })
    yield* readNdjsonLines<T>(response.body)
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers)
    if (!headers.has('Accept')) headers.set('Accept', 'application/json')
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`)

    let response: Response
    try {
      response = await this.fetchImpl(`${this.hubUrl}${path}`, { ...init, headers })
    } catch (cause) {
      // undici's bare "fetch failed" names neither host nor cause —
      // useless at a terminal. Say where we tried to go and, for local
      // hubs, what is probably missing.
      const detail =
        cause instanceof Error
          ? cause.cause instanceof Error
            ? cause.cause.message
            : cause.message
          : String(cause)
      const localHint = /127\.0\.0\.1|localhost/.test(this.hubUrl)
        ? ' Is the local hub running? Start it with `pnpm --filter @spool/backend dev` (and `pnpm --filter @spool/web dev` when using port 3002). Note: vite often binds IPv6-only — if the server is up but 127.0.0.1 is refused, use http://localhost:<port> instead.'
        : ''
      throw new Error(`Cannot reach the hub at ${this.hubUrl} (${detail}).${localHint}`)
    }
    if (!response.ok) {
      throw new HubHttpError(response.status, await readErrorMessage(response))
    }
    return response
  }
}

export async function* readNdjsonLines<T>(
  body: ReadableStream<Uint8Array> | null,
): AsyncGenerator<T> {
  if (!body) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lineNumber = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        lineNumber += 1
        const parsed = parseNdjsonLine<T>(line, lineNumber)
        if (parsed !== undefined) yield parsed
      }

      if (done) break
    }

    if (buffer !== '') {
      lineNumber += 1
      const parsed = parseNdjsonLine<T>(buffer, lineNumber)
      if (parsed !== undefined) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}

/** Keep new clients compatible with Hub deployments from before the
 *  Summary rename. The canonical client surface remains `summaryMd`. */
function withLegacySummaryAlias(
  body: HubSessionWriteRequest,
): HubSessionWriteRequest & { noteMd: string | null } {
  return { ...body, noteMd: body.summaryMd }
}

function parseNdjsonLine<T>(line: string, lineNumber: number): T | undefined {
  const value = line.endsWith('\r') ? line.slice(0, -1) : line
  if (value.trim() === '') return undefined
  try {
    return JSON.parse(value) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid NDJSON on line ${lineNumber}: ${message}`)
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (text === '') return undefined as T
  try {
    return JSON.parse(text) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid JSON response from hub: ${message}`)
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  const text = (await response.text()).trim()
  if (text !== '') {
    try {
      const body: unknown = JSON.parse(text)
      if (typeof body === 'string') return body
      if (isRecord(body)) {
        if (typeof body['detail'] === 'string') return body['detail']
        if (typeof body['message'] === 'string') return body['message']
        if (typeof body['error'] === 'string') return body['error']
      }
    } catch {
      return text
    }
    return text
  }
  return response.statusText || 'Unknown hub error'
}

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

function normalizeHubUrl(value: string): string {
  const normalized = stripTrailingSlashes(value.trim())
  const url = new URL(normalized)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Hub URL must use http or https')
  }
  return normalized
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

import { z } from 'zod'

import { ApiError, type ErrorCode } from '../errors'

const DEFAULT_API_BASE = 'https://api.workos.com'
const REQUEST_TIMEOUT_MS = 5_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MEMBERSHIP_PAGE_SIZE = 100
const MAX_MEMBERSHIP_PAGES = 20
const INVITATION_PAGE_SIZE = 100
const MAX_INVITATION_PAGES = 20

export type WorkosTeamClientOptions = {
  timeoutMs?: number
  maxResponseBytes?: number
}

const WorkosOrganization = z
  .object({ id: z.string().min(1), name: z.string().min(1) })
  .passthrough()

const WorkosMembership = z
  .object({
    id: z.string().min(1),
    user_id: z.string().min(1),
    organization_id: z.string().min(1),
    status: z.enum(['active', 'inactive', 'pending']),
    updated_at: z.iso.datetime().optional(),
  })
  .passthrough()

const WorkosInvitation = z
  .object({
    id: z.string().min(1),
    email: z.email(),
    state: z.enum(['pending', 'accepted', 'revoked', 'expired']),
    organization_id: z.string().nullable().optional(),
    accepted_user_id: z.string().nullable().optional(),
    expires_at: z.string().nullable().optional(),
    accepted_at: z.string().nullable().optional(),
    revoked_at: z.string().nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .passthrough()

const MembershipList = z
  .object({
    data: z.array(WorkosMembership),
    list_metadata: z.object({ after: z.string().nullable().optional() }).passthrough(),
  })
  .passthrough()
const InvitationList = z
  .object({
    data: z.array(WorkosInvitation),
    list_metadata: z.object({ after: z.string().nullable().optional() }).passthrough(),
  })
  .passthrough()

const WorkosWebhookEndpoint = z
  .object({
    id: z.string().min(1),
    endpoint_url: z.url(),
    secret: z.string().min(1),
    status: z.enum(['enabled', 'disabled']),
    events: z.array(z.string()),
  })
  .passthrough()
const WebhookEndpointList = z
  .object({
    data: z.array(WorkosWebhookEndpoint),
    list_metadata: z.object({ after: z.string().nullable().optional() }).passthrough(),
  })
  .passthrough()

export type WorkosOrganization = z.infer<typeof WorkosOrganization>
export type WorkosMembership = z.infer<typeof WorkosMembership>
export type WorkosInvitation = z.infer<typeof WorkosInvitation>
export type WorkosWebhookEndpoint = z.infer<typeof WorkosWebhookEndpoint>

export type WorkosTeamEnv = {
  WORKOS_API_KEY?: string
  DEV_WORKOS_API_URL?: string
}

export type WorkosTeamClient = ReturnType<typeof createWorkosTeamClient>

export function createWorkosTeamClient(
  env: WorkosTeamEnv,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  options: WorkosTeamClientOptions = {},
) {
  const apiKey = env.WORKOS_API_KEY
  if (!apiKey) throw new ApiError('INTERNAL', 'no WORKOS_API_KEY')
  const apiBase = normalizeApiBase(env.DEV_WORKOS_API_URL ?? DEFAULT_API_BASE)
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxResponseBytes = options.maxResponseBytes ?? MAX_RESPONSE_BYTES
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError('INTERNAL', 'invalid WorkOS request timeout')
  }
  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes <= 0) {
    throw new ApiError('INTERNAL', 'invalid WorkOS response limit')
  }

  async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...Object.fromEntries(new Headers(init.headers)),
        },
        signal: controller.signal,
      })
      if (!response.ok) {
        const detail = await readBoundedError(response, maxResponseBytes)
        const code: ErrorCode =
          response.status === 404 ? 'NOT_FOUND' : response.status === 409 ? 'CONFLICT' : 'INTERNAL'
        throw new ApiError(code, detail ? `WorkOS: ${detail}` : `WorkOS HTTP ${response.status}`)
      }
      const value = await readBoundedJson(response, maxResponseBytes)
      const parsed = schema.safeParse(value)
      if (!parsed.success) throw new ApiError('INTERNAL', 'invalid WorkOS response')
      return parsed.data
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (controller.signal.aborted) throw new ApiError('INTERNAL', 'WorkOS request timed out')
      throw new ApiError(
        'INTERNAL',
        `WorkOS request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  async function noContent(path: string, init: RequestInit): Promise<void> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(`${apiBase}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          ...Object.fromEntries(new Headers(init.headers)),
        },
        signal: controller.signal,
      })
      // Deletes are deliberately idempotent. A WorkOS object that is already
      // gone is equivalent to a successful compensation/retry.
      if (response.status === 404) return
      if (!response.ok) {
        const detail = await readBoundedError(response, maxResponseBytes)
        throw new ApiError(
          'INTERNAL',
          detail ? `WorkOS: ${detail}` : `WorkOS HTTP ${response.status}`,
        )
      }
    } catch (error) {
      if (error instanceof ApiError) throw error
      if (controller.signal.aborted) throw new ApiError('INTERNAL', 'WorkOS request timed out')
      throw new ApiError(
        'INTERNAL',
        `WorkOS request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    createOrganization(name: string, externalId: string): Promise<WorkosOrganization> {
      return request(
        '/organizations',
        {
          method: 'POST',
          headers: { 'idempotency-key': `spool-team-org-${externalId}` },
          body: JSON.stringify({ name, external_id: externalId }),
        },
        WorkosOrganization,
      )
    },

    getOrganizationByExternalId(externalId: string): Promise<WorkosOrganization> {
      return request(
        `/organizations/external_id/${encodeURIComponent(externalId)}`,
        { method: 'GET' },
        WorkosOrganization,
      )
    },

    updateOrganization(id: string, name: string): Promise<WorkosOrganization> {
      return request(
        `/organizations/${encodeURIComponent(id)}`,
        { method: 'PUT', body: JSON.stringify({ name }) },
        WorkosOrganization,
      )
    },

    deleteOrganization(id: string): Promise<void> {
      return noContent(`/organizations/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    createMembership(organizationId: string, userId: string): Promise<WorkosMembership> {
      return request(
        '/user_management/organization_memberships',
        {
          method: 'POST',
          headers: {
            'idempotency-key': `spool-team-membership-${organizationId}-${userId}`,
          },
          body: JSON.stringify({
            organization_id: organizationId,
            user_id: userId,
            role_slug: 'member',
          }),
        },
        WorkosMembership,
      )
    },

    deleteMembership(id: string): Promise<void> {
      return noContent(`/user_management/organization_memberships/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },

    getMembership(id: string): Promise<WorkosMembership> {
      return request(
        `/user_management/organization_memberships/${encodeURIComponent(id)}`,
        { method: 'GET' },
        WorkosMembership,
      )
    },

    async listActiveMemberships(userId: string): Promise<WorkosMembership[]> {
      const memberships: WorkosMembership[] = []
      const seenCursors = new Set<string>()
      let after: string | null = null
      for (let page = 0; page < MAX_MEMBERSHIP_PAGES; page++) {
        const query = new URLSearchParams({
          user_id: userId,
          limit: String(MEMBERSHIP_PAGE_SIZE),
        })
        query.append('statuses[]', 'active')
        if (after) query.set('after', after)
        const result = await request(
          `/user_management/organization_memberships?${query.toString()}`,
          { method: 'GET' },
          MembershipList,
        )
        memberships.push(...result.data)
        const next = result.list_metadata?.after ?? null
        if (!next) return memberships
        if (seenCursors.has(next)) {
          throw new ApiError('INTERNAL', 'invalid WorkOS membership pagination')
        }
        seenCursors.add(next)
        after = next
      }
      throw new ApiError('INTERNAL', 'WorkOS membership pagination exceeds safe limit')
    },

    createInvitation(args: {
      email: string
      organizationId: string
      inviterUserId: string
      idempotencyKey: string
    }): Promise<WorkosInvitation> {
      return request(
        '/user_management/invitations',
        {
          method: 'POST',
          headers: { 'idempotency-key': args.idempotencyKey },
          body: JSON.stringify({
            email: args.email,
            organization_id: args.organizationId,
            inviter_user_id: args.inviterUserId,
            // WorkOS remains transport-only. Spool's local desired role is
            // projected in D1 and must never depend on a WorkOS admin role.
            role_slug: 'member',
          }),
        },
        WorkosInvitation,
      )
    },

    getInvitation(id: string): Promise<WorkosInvitation> {
      return request(
        `/user_management/invitations/${encodeURIComponent(id)}`,
        { method: 'GET' },
        WorkosInvitation,
      )
    },

    async listInvitations(organizationId: string): Promise<WorkosInvitation[]> {
      const query = new URLSearchParams({
        organization_id: organizationId,
        limit: String(INVITATION_PAGE_SIZE),
      })
      return (
        await request(
          `/user_management/invitations?${query.toString()}`,
          { method: 'GET' },
          InvitationList,
        )
      ).data
    },

    async listAllInvitations(organizationId: string): Promise<WorkosInvitation[]> {
      const invitations: WorkosInvitation[] = []
      const seenCursors = new Set<string>()
      let after: string | null = null
      for (let page = 0; page < MAX_INVITATION_PAGES; page++) {
        const query = new URLSearchParams({
          organization_id: organizationId,
          limit: String(INVITATION_PAGE_SIZE),
        })
        if (after) query.set('after', after)
        const result = await request(
          `/user_management/invitations?${query.toString()}`,
          { method: 'GET' },
          InvitationList,
        )
        invitations.push(...result.data)
        const next = result.list_metadata.after ?? null
        if (!next) return invitations
        if (seenCursors.has(next)) {
          throw new ApiError('INTERNAL', 'invalid WorkOS invitation pagination')
        }
        seenCursors.add(next)
        after = next
      }
      throw new ApiError('INTERNAL', 'WorkOS invitation pagination exceeds safe limit')
    },

    resendInvitation(id: string): Promise<WorkosInvitation> {
      return request(
        `/user_management/invitations/${encodeURIComponent(id)}/resend`,
        { method: 'POST' },
        WorkosInvitation,
      )
    },

    revokeInvitation(id: string): Promise<WorkosInvitation> {
      return request(
        `/user_management/invitations/${encodeURIComponent(id)}/revoke`,
        { method: 'POST' },
        WorkosInvitation,
      )
    },

    async listWebhookEndpoints(): Promise<WorkosWebhookEndpoint[]> {
      const endpoints: WorkosWebhookEndpoint[] = []
      const seenCursors = new Set<string>()
      let after: string | null = null
      for (let page = 0; page < MAX_INVITATION_PAGES; page++) {
        const query = new URLSearchParams({ limit: String(INVITATION_PAGE_SIZE) })
        if (after) query.set('after', after)
        const result = await request(
          `/webhook_endpoints?${query.toString()}`,
          { method: 'GET' },
          WebhookEndpointList,
        )
        endpoints.push(...result.data)
        const next = result.list_metadata.after ?? null
        if (!next) return endpoints
        if (seenCursors.has(next)) {
          throw new ApiError('INTERNAL', 'invalid WorkOS webhook endpoint pagination')
        }
        seenCursors.add(next)
        after = next
      }
      throw new ApiError('INTERNAL', 'WorkOS webhook endpoint pagination exceeds safe limit')
    },

    createWebhookEndpoint(endpointUrl: string, events: readonly string[]) {
      return request(
        '/webhook_endpoints',
        { method: 'POST', body: JSON.stringify({ endpoint_url: endpointUrl, events }) },
        WorkosWebhookEndpoint,
      )
    },

    updateWebhookEndpoint(id: string, endpointUrl: string, events: readonly string[]) {
      return request(
        `/webhook_endpoints/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ endpoint_url: endpointUrl, events, status: 'enabled' }),
        },
        WorkosWebhookEndpoint,
      )
    },
  }
}

function normalizeApiBase(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ApiError('INTERNAL', 'invalid WorkOS API base URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ApiError('INTERNAL', 'invalid WorkOS API base URL')
  }
  return url.toString().replace(/\/$/, '')
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const bytes = await readBoundedBody(response, maxBytes)
  if (bytes.byteLength === 0) return null
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new ApiError('INTERNAL', 'invalid WorkOS JSON response')
  }
}

async function readBoundedError(response: Response, maxBytes: number): Promise<string> {
  try {
    const value = await readBoundedJson(response, maxBytes)
    if (typeof value === 'string') return value.slice(0, 500)
    if (isObject(value)) {
      const message = value['message'] ?? value['error']
      if (typeof message === 'string') return message.slice(0, 500)
    }
  } catch {
    // Preserve the upstream status when its error body is malformed/oversized.
  }
  return ''
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) {
    throw new ApiError('INTERNAL', 'WorkOS response too large')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new ApiError('INTERNAL', 'WorkOS response too large')
    }
    chunks.push(value)
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

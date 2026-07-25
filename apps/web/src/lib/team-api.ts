import type { ManagedSession, ManagedSessionPage } from './hub-management-api'

// Typed browser client for the account/team management surface. Authorization
// remains entirely server-side: UI affordances read the `permissions` array
// returned for the active team and never infer capabilities from `role`.

export type TeamRole = 'owner' | 'admin' | 'member'
export type TeamPermission =
  | 'team:update'
  | 'team:archive'
  | 'members:invite'
  | 'members:manage'
  | 'sessions:manage'
  | 'team:leave'

export interface TeamSummary {
  id: string
  name: string
  slug?: string | null
  role?: TeamRole | null
  permissions: TeamPermission[]
  member_count?: number
  archived_at?: number | null
}

export const TEAM_SUMMARY_CHANGED = 'spool:team-summary-changed' as const

declare global {
  interface WindowEventMap {
    [TEAM_SUMMARY_CHANGED]: CustomEvent<TeamSummary>
  }
}

/**
 * Keep independently mounted workspace chrome in sync with a confirmed Team
 * mutation. Authorization still comes from the next server request; this
 * event only updates already-authorized navigation copy immediately.
 */
export function announceTeamSummaryChanged(team: TeamSummary): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TEAM_SUMMARY_CHANGED, { detail: team }))
  }
}

export interface TeamMember {
  user_id: string
  email: string
  display_name: string
  avatar_url?: string | null
  role: TeamRole
  joined_at?: number | null
  permissions: TeamMemberPermission[]
}

export type TeamMemberPermission = 'role:update' | 'remove' | 'ownership:transfer'

export interface TeamInvitation {
  id: string
  email: string
  role: Exclude<TeamRole, 'owner'>
  status?: 'pending' | 'accepted' | 'revoked' | 'expired'
  expires_at?: number | null
}

export type TeamSession = ManagedSession

export type TeamApiFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; detail?: string }
  | { kind: 'not-found' }
  | { kind: 'conflict'; detail?: string }
  | { kind: 'invalid'; detail?: string }
  | { kind: 'rate-limited' }
  | { kind: 'error'; detail?: string }

export type TeamApiResult<T> = { kind: 'ok'; data: T } | TeamApiFailure

interface ErrorBody {
  detail?: string
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<TeamApiResult<T>> {
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
    if (response.status === 409) return { kind: 'conflict', ...(detail ? { detail } : {}) }
    if (response.status === 422 || response.status === 400) {
      return { kind: 'invalid', ...(detail ? { detail } : {}) }
    }
    if (response.status === 429) return { kind: 'rate-limited' }
    // User-action failures above are safe and useful to explain. Do not pass
    // upstream/5xx diagnostics (for example WorkOS details) through to the UI.
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

function jsonBody(value: unknown): string {
  return JSON.stringify(value)
}

function teamPath(teamId: string, suffix = ''): string {
  return `/api/teams/${encodeURIComponent(teamId)}${suffix}`
}

export function hasTeamPermission(team: TeamSummary, permission: TeamPermission): boolean {
  return team.permissions.includes(permission)
}

export async function fetchTeams(): Promise<TeamApiResult<{ teams: TeamSummary[] }>> {
  return requestJson('/api/teams')
}

export async function createTeam(
  name: string,
  idempotencyKey: string,
): Promise<TeamApiResult<{ team: TeamSummary }>> {
  return requestJson('/api/teams', {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: jsonBody({ name }),
  })
}

export async function fetchTeam(teamId: string): Promise<TeamApiResult<{ team: TeamSummary }>> {
  return requestJson(teamPath(teamId))
}

export async function updateTeam(
  teamId: string,
  name: string,
): Promise<TeamApiResult<{ team: TeamSummary }>> {
  return requestJson(teamPath(teamId), { method: 'PATCH', body: jsonBody({ name }) })
}

export async function archiveTeam(teamId: string): Promise<TeamApiResult<Record<string, never>>> {
  return requestJson(teamPath(teamId), { method: 'DELETE' })
}

export async function fetchTeamMembers(
  teamId: string,
): Promise<TeamApiResult<{ members: TeamMember[] }>> {
  return requestJson(teamPath(teamId, '/members'))
}

export async function updateTeamMember(
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<TeamApiResult<{ member: TeamMember }>> {
  return requestJson(teamPath(teamId, `/members/${encodeURIComponent(userId)}`), {
    method: 'PATCH',
    body: jsonBody({ role }),
  })
}

export async function removeTeamMember(
  teamId: string,
  userId: string,
): Promise<TeamApiResult<Record<string, never>>> {
  return requestJson(teamPath(teamId, `/members/${encodeURIComponent(userId)}`), {
    method: 'DELETE',
  })
}

export async function leaveTeam(teamId: string): Promise<TeamApiResult<Record<string, never>>> {
  return requestJson(teamPath(teamId, '/leave'), { method: 'POST' })
}

export async function fetchTeamInvitations(
  teamId: string,
): Promise<TeamApiResult<{ invitations: TeamInvitation[] }>> {
  return requestJson(teamPath(teamId, '/invitations'))
}

export async function createTeamInvitation(
  teamId: string,
  email: string,
  role: Exclude<TeamRole, 'owner'>,
  idempotencyKey: string,
): Promise<TeamApiResult<{ invitation: TeamInvitation }>> {
  return requestJson(teamPath(teamId, '/invitations'), {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: jsonBody({ email, role }),
  })
}

export async function resendTeamInvitation(
  teamId: string,
  invitationId: string,
): Promise<TeamApiResult<{ invitation: TeamInvitation }>> {
  return requestJson(teamPath(teamId, `/invitations/${encodeURIComponent(invitationId)}/resend`), {
    method: 'POST',
  })
}

export async function revokeTeamInvitation(
  teamId: string,
  invitationId: string,
): Promise<TeamApiResult<{ invitation: TeamInvitation }>> {
  return requestJson(teamPath(teamId, `/invitations/${encodeURIComponent(invitationId)}/revoke`), {
    method: 'POST',
  })
}

export async function fetchTeamSessions(
  teamId: string,
  cursor: string | null = null,
): Promise<TeamApiResult<ManagedSessionPage>> {
  const query = cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
  return requestJson(`${teamPath(teamId, '/sessions')}${query}`)
}

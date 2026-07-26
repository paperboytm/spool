import type { ManagedSession } from './hub-management-api'

export type ProjectOwnerKind = 'user' | 'team'

export interface ProjectOwner {
  kind: ProjectOwnerKind
  id: string
  handle: string
  name: string
  avatar_url?: string | null
}

export interface ProjectSummary {
  id: string
  slug: string
  name: string
  description: string | null
  github_url: string | null
  owner: ProjectOwner
  session_count: number
  /** Absent only while an older backend is rolling out. */
  star_count?: number
  updated_at: number
  archived_at: number | null
  can_manage: boolean
}

export interface ProjectPage {
  project: ProjectSummary
  sessions: ManagedSession[]
  next_cursor: string | null
}

export interface ProjectOwnerPage {
  owner: ProjectOwner
  projects: ProjectSummary[]
  sessions: ManagedSession[]
  session_count: number
  next_cursor: string | null
}

export type ProjectApiFailure =
  | { kind: 'unauthenticated' }
  | { kind: 'forbidden'; detail?: string }
  | { kind: 'not-found' }
  | { kind: 'conflict'; detail?: string }
  | { kind: 'invalid'; detail?: string }
  | { kind: 'rate-limited' }
  | { kind: 'error' }

export type ProjectApiResult<T> = { kind: 'ok'; data: T } | ProjectApiFailure

interface ErrorBody {
  detail?: string
}

export interface ProjectSocialState {
  version: 1
  starCount: number
  watcherCount: number
  viewerStarred: boolean
  viewerWatching: boolean
  viewerAuthenticated: boolean
  starEligible: boolean
  canStar: boolean
  canWatch: boolean
}

export interface UserFollowState {
  version: 1
  followerCount: number
  followingCount: number
  viewerFollowing: boolean
  viewerAuthenticated: boolean
  viewerIsSelf: boolean
  canFollow: boolean
}

export interface SocialIdentity {
  id: string
  handle: string
  name: string
  avatar_url: string | null
}

interface SocialProject {
  id: string
  slug: string
  name: string
  description: string | null
  github_url: string | null
  owner: ProjectOwner
  session_count: number
  star_count: number
  updated_at: number
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<ProjectApiResult<T>> {
  try {
    const headers = new Headers(init.headers)
    headers.set('accept', 'application/json')
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    const response = await fetch(path, { ...init, headers, credentials: 'same-origin' })
    if (response.ok) return { kind: 'ok', data: (await response.json()) as T }

    const body = (await response.json().catch(() => ({}))) as ErrorBody
    const detail = body.detail
    if (response.status === 401) return { kind: 'unauthenticated' }
    if (response.status === 403) return { kind: 'forbidden', ...(detail ? { detail } : {}) }
    if (response.status === 404) return { kind: 'not-found' }
    if (response.status === 409) return { kind: 'conflict', ...(detail ? { detail } : {}) }
    if (response.status === 400 || response.status === 422) {
      return { kind: 'invalid', ...(detail ? { detail } : {}) }
    }
    if (response.status === 429) return { kind: 'rate-limited' }
    return { kind: 'error' }
  } catch {
    return { kind: 'error' }
  }
}

function queryPage(cursor: string | null): string {
  return cursor === null ? '' : `?cursor=${encodeURIComponent(cursor)}`
}

export function fetchPublicProjects(
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return requestJson(`/api/projects${queryPage(cursor)}`)
}

export function fetchMyProjects(
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return requestJson(`/api/me/projects${queryPage(cursor)}`)
}

export function fetchTeamProjects(
  teamId: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return requestJson(`/api/teams/${encodeURIComponent(teamId)}/projects${queryPage(cursor)}`)
}

export async function fetchAllTeamProjects(
  teamId: string,
): Promise<ProjectApiResult<{ projects: ProjectSummary[] }>> {
  const projects: ProjectSummary[] = []
  const projectIds = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | null = null

  while (true) {
    const result = await fetchTeamProjects(teamId, cursor)
    if (result.kind !== 'ok') return result

    for (const project of result.data.projects) {
      if (projectIds.has(project.id)) continue
      projectIds.add(project.id)
      projects.push(project)
    }

    const nextCursor = result.data.next_cursor
    if (nextCursor === null) return { kind: 'ok', data: { projects } }
    if (cursors.has(nextCursor)) return { kind: 'error' }
    cursors.add(nextCursor)
    cursor = nextCursor
  }
}

export function fetchOwnerProject(
  handle: string,
  slug: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<ProjectPage>> {
  return requestJson(
    `/api/owners/${encodeURIComponent(handle)}/projects/${encodeURIComponent(slug)}${queryPage(cursor)}`,
  )
}

export function fetchOwnerProjects(
  handle: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<ProjectOwnerPage>> {
  return requestJson(`/api/owners/${encodeURIComponent(handle)}/projects${queryPage(cursor)}`)
}

export function fetchManagedProject(
  projectId: string,
  teamId?: string,
): Promise<ProjectApiResult<ProjectPage>> {
  const prefix = teamId ? `/api/teams/${encodeURIComponent(teamId)}/projects` : '/api/me/projects'
  return requestJson(`${prefix}/${encodeURIComponent(projectId)}`)
}

export interface ProjectWrite {
  name: string
  slug: string
  description: string | null
  github_url: string | null
}

export function createProject(
  input: ProjectWrite,
  idempotencyKey: string,
  teamId?: string,
): Promise<ProjectApiResult<{ project: ProjectSummary }>> {
  const path = teamId ? `/api/teams/${encodeURIComponent(teamId)}/projects` : '/api/me/projects'
  return requestJson(path, {
    method: 'POST',
    headers: { 'idempotency-key': idempotencyKey },
    body: JSON.stringify(input),
  })
}

export function updateProject(
  projectId: string,
  input: ProjectWrite,
  teamId?: string,
): Promise<ProjectApiResult<{ project: ProjectSummary }>> {
  const prefix = teamId ? `/api/teams/${encodeURIComponent(teamId)}/projects` : '/api/me/projects'
  return requestJson(`${prefix}/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function archiveProject(
  projectId: string,
  teamId?: string,
): Promise<ProjectApiResult<{ project: ProjectSummary }>> {
  const prefix = teamId ? `/api/teams/${encodeURIComponent(teamId)}/projects` : '/api/me/projects'
  return requestJson(`${prefix}/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  })
}

function ownerProjectSocialPath(handle: string, slug: string, action: string): string {
  return `/api/owners/${encodeURIComponent(handle)}/projects/${encodeURIComponent(slug)}/${action}`
}

export function fetchProjectSocial(
  handle: string,
  slug: string,
): Promise<ProjectApiResult<ProjectSocialState>> {
  return requestJson(ownerProjectSocialPath(handle, slug, 'social'))
}

export function fetchProjectStargazers(
  handle: string,
  slug: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<{ stargazers: SocialIdentity[]; next_cursor: string | null }>> {
  return requestJson(`${ownerProjectSocialPath(handle, slug, 'stargazers')}${queryPage(cursor)}`)
}

export function setProjectStar(
  handle: string,
  slug: string,
  starred: boolean,
): Promise<ProjectApiResult<ProjectSocialState>> {
  return requestJson(ownerProjectSocialPath(handle, slug, 'star'), {
    method: starred ? 'PUT' : 'DELETE',
  })
}

export function setProjectWatch(
  handle: string,
  slug: string,
  watching: boolean,
): Promise<ProjectApiResult<ProjectSocialState>> {
  return requestJson(ownerProjectSocialPath(handle, slug, 'watch'), {
    method: watching ? 'PUT' : 'DELETE',
  })
}

export function fetchUserFollow(handle: string): Promise<ProjectApiResult<UserFollowState>> {
  return requestJson(`/api/owners/${encodeURIComponent(handle)}/follow`)
}

export function setUserFollow(
  handle: string,
  following: boolean,
): Promise<ProjectApiResult<UserFollowState>> {
  return requestJson(`/api/owners/${encodeURIComponent(handle)}/follow`, {
    method: following ? 'PUT' : 'DELETE',
  })
}

export function fetchFollowers(
  handle: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<{ followers: SocialIdentity[]; next_cursor: string | null }>> {
  return requestJson(`/api/owners/${encodeURIComponent(handle)}/followers${queryPage(cursor)}`)
}

export function fetchFollowing(
  handle: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<{ following: SocialIdentity[]; next_cursor: string | null }>> {
  return requestJson(`/api/owners/${encodeURIComponent(handle)}/following${queryPage(cursor)}`)
}

export function fetchOwnerStarredProjects(
  handle: string,
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return fetchSocialProjects(
    `/api/owners/${encodeURIComponent(handle)}/starred-projects${queryPage(cursor)}`,
  )
}

export function fetchMyStarredProjects(
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return fetchSocialProjects(`/api/me/starred-projects${queryPage(cursor)}`)
}

export function fetchMyWatchingProjects(
  cursor: string | null = null,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  return fetchSocialProjects(`/api/me/watching-projects${queryPage(cursor)}`)
}

async function fetchSocialProjects(
  path: string,
): Promise<ProjectApiResult<{ projects: ProjectSummary[]; next_cursor: string | null }>> {
  const result = await requestJson<{
    projects: SocialProject[]
    next_cursor: string | null
  }>(path)
  if (result.kind !== 'ok') return result
  return {
    kind: 'ok',
    data: {
      next_cursor: result.data.next_cursor,
      projects: result.data.projects.map((project) => ({
        ...project,
        archived_at: null,
        can_manage: false,
      })),
    },
  }
}

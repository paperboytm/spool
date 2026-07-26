// Minimal in-memory stand-ins for KVNamespace, D1Database, and R2Bucket
// — only the surface area used by tests. Kept hand-rolled rather than
// pulling in miniflare to keep test boot time low.

import type { D1Database, KVNamespace, R2Bucket } from '@cloudflare/workers-types'
import type { SessionProvider } from '@spool-lab/session-kit'

type KvVal = { value: string; expiresAt: number | null }

export function makeKv(): KVNamespace {
  const store = new Map<string, KvVal>()
  const now = () => Date.now()
  const kv = {
    async get(key: string): Promise<string | null> {
      const v = store.get(key)
      if (!v) return null
      if (v.expiresAt !== null && v.expiresAt <= now()) {
        store.delete(key)
        return null
      }
      return v.value
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void> {
      const expiresAt = opts?.expirationTtl ? now() + opts.expirationTtl * 1000 : null
      store.set(key, { value, expiresAt })
    },
    async delete(key: string): Promise<void> {
      store.delete(key)
    },
  }
  return kv as unknown as KVNamespace
}

type UserRow = {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: number
  last_signin_at: number
  deletion_pending_until: number | null
  deleted_at: number | null
  // v0.6+ profile customization. Optional in the fake so existing
  // test fixtures (which push rows without these fields) stay valid;
  // SQL matchers coerce missing values to NULL / 1 (the column
  // defaults).
  display_name?: string | null
  custom_avatar_id?: string | null
  avatar_visible?: number
}

type AuditRow = {
  user_id: string | null
  ip_hash: string
  ua_hash: string
  action: string
  target_id: string | null
  details_json: string | null
  ts: number
}

type UserIdentityRow = {
  provider: string
  provider_sub: string
  user_id: string
  email: string | null
  linked_at: number
}

type HandleRow = {
  handle: string
  user_id: string | null
  team_id?: string | null
  claimed_at: number
  released_at: number | null
}

type PublishedShareRow = {
  id: string
  user_id: string
  title: string
  visibility: string
  expires_at: number | null
  version: number
  published_at: number
  republished_at: number | null
  revoked_at: number | null
  // Optional so existing test fixtures pushing literal rows without a
  // draft_id stay valid; reads coerce missing to null.
  draft_id?: string | null
  client_request_id?: string | null
}

type DeletionQueueRow = {
  user_id: string
  scheduled_at: number
  cancelled: number
  state?: 'pending' | 'processing' | 'cancelled'
  processing_token?: string | null
  processing_lease_until?: number | null
}

type HubSessionRow = {
  sid: string
  owner_user_id: string
  root: string
  record_count: number
  sig: string | null
  card_json: string | null
  note_md: string | null
  lineage_json: string | null
  view_oid: string | null
  spool_file_oid: string | null
  cost_usd: number | null
  total_tokens: number | null
  visibility: string
  // Added in migration 0007. Optional keeps pre-Team fixtures readable while
  // still letting deletion tests distinguish personal and Team-owned rows.
  team_id?: string | null
  // Added in migration 0014. Optional keeps older fixture literals source
  // compatible; all new Hub commits below resolve and persist a Project.
  project_id?: string
  withdrawn_at: number | null
  created_at: number
  updated_at: number
}

type HubObjectRow = {
  owner_user_id: string
  oid: string
  size: number
  pack_key: string
  offset: number
  length: number
  created_at: number
}

type HubTeamObjectRow = Omit<HubObjectRow, 'owner_user_id'> & {
  team_id: string
}

type TeamRow = {
  id: string
  name: string
  workos_organization_id?: string
  deletion_pending_until?: number | null
  archived_at: number | null
}

type TeamMembershipRow = {
  team_id: string
  user_id: string
  role: 'owner' | 'admin' | 'member'
  workos_membership_id?: string | null
}

type ProjectRow = {
  id: string
  owner_user_id: string | null
  owner_team_id: string | null
  slug: string
  name: string
  description: string | null
  github_url: string | null
  created_by_user_id: string
  created_at: number
  updated_at: number
  archived_at: number | null
}

type ProjectCreationRequestRow = {
  actor_user_id: string
  owner_scope: string
  owner_user_id: string | null
  owner_team_id: string | null
  idempotency_key: string
  project_id: string
  request_hash: string
  created_at: number
}

type ProjectSocialRelationRow = {
  project_id: string
  user_id: string
  created_at: number
}

type ApiTokenRow = {
  id: string
  user_id: string
  token_hash: string
  label: string | null
  created_at: number
  last_used_at: number | null
}

type HubSessionDiscoveryRow = {
  sid: string
  agent: SessionProvider
  title: string
  title_json: string | null
  cost_usd: number | null
  total_tokens: number | null
  summary_text: string | null
  summary_text_zh: string | null
  search_text: string
  message_count: number
  tool_call_count: number
  file_count: number
  additions: number
  deletions: number
  lineage_source_sid: string | null
  quality_score: number
  published_at: number
  updated_at: number
}

type HubSessionEngagementDailyRow = {
  sid: string
  day: string
  qualified_reads: number
}

type HubSessionStarRow = {
  sid: string
  user_id: string
  created_at: number
}

type HubSessionGuidanceRow = {
  sid: string
  root: string
  guidance_json: string
  generated_at: number
}

type HubSessionResumeGrantRow = {
  token_hash: string
  source_sid: string
  source_root: string
  source_position: number
  created_at: number
  expires_at: number
  claimed_child_sid: string | null
  claimed_child_root: string | null
  claimed_at: number | null
}

type HubSessionVerifiedForkRow = {
  child_sid: string
  source_sid: string
  source_root: string
  source_position: number
  child_root: string
  grant_token_hash: string
  verified_at: number
}

export type WorkosCleanupOutboxRow = {
  id: string
  operation: 'membership.delete' | 'organization.delete' | 'invitation.revoke'
  resource_id: string
  team_id: string | null
  user_id: string | null
  attempts: number
  next_attempt_at: number
  last_error: string | null
  created_at: number
  updated_at: number
}

export type FakeDbState = {
  users: UserRow[]
  audit: AuditRow[]
  user_identities: UserIdentityRow[]
  handles: HandleRow[]
  published_shares: PublishedShareRow[]
  deletion_queue: DeletionQueueRow[]
  hub_sessions: HubSessionRow[]
  hub_objects: HubObjectRow[]
  hub_team_objects: HubTeamObjectRow[]
  teams: TeamRow[]
  team_memberships: TeamMembershipRow[]
  projects: ProjectRow[]
  project_creation_requests: ProjectCreationRequestRow[]
  project_stars: ProjectSocialRelationRow[]
  project_watches: ProjectSocialRelationRow[]
  workos_cleanup_outbox: WorkosCleanupOutboxRow[]
  api_tokens: ApiTokenRow[]
  hub_session_discovery: HubSessionDiscoveryRow[]
  hub_session_engagement_daily: HubSessionEngagementDailyRow[]
  hub_session_stars: HubSessionStarRow[]
  hub_session_guidance: HubSessionGuidanceRow[]
  hub_session_resume_grants: HubSessionResumeGrantRow[]
  hub_session_verified_forks: HubSessionVerifiedForkRow[]
}

export function emptyState(): FakeDbState {
  return {
    users: [],
    audit: [],
    user_identities: [],
    handles: [],
    published_shares: [],
    deletion_queue: [],
    hub_sessions: [],
    hub_objects: [],
    hub_team_objects: [],
    teams: [],
    team_memberships: [],
    projects: [],
    project_creation_requests: [],
    project_stars: [],
    project_watches: [],
    workos_cleanup_outbox: [],
    api_tokens: [],
    hub_session_discovery: [],
    hub_session_engagement_daily: [],
    hub_session_stars: [],
    hub_session_guidance: [],
    hub_session_resume_grants: [],
    hub_session_verified_forks: [],
  }
}

export function makeDb(state: FakeDbState = emptyState()): {
  db: D1Database
  state: FakeDbState
} {
  function deletionState(row: DeletionQueueRow): 'pending' | 'processing' | 'cancelled' {
    return row.state ?? (row.cancelled === 1 ? 'cancelled' : 'pending')
  }

  function activeTeamRoleFor(teamId: string, userId: string): TeamMembershipRow['role'] | null {
    const team = state.teams.find(
      (row) =>
        row.id === teamId &&
        row.archived_at === null &&
        (row.deletion_pending_until ?? null) === null,
    )
    if (!team) return null
    return (
      state.team_memberships.find((row) => row.team_id === teamId && row.user_id === userId)
        ?.role ?? null
    )
  }

  function activeProjectFor(
    projectId: string,
    ownerUserId: string | null,
    ownerTeamId: string | null,
  ): ProjectRow | null {
    return (
      state.projects.find(
        (row) =>
          row.id === projectId &&
          row.owner_user_id === ownerUserId &&
          row.owner_team_id === ownerTeamId &&
          row.archived_at === null,
      ) ?? null
    )
  }

  function hydratedManagedSessionFields(
    session: HubSessionRow,
  ): Record<string, string | number | null> {
    const project = state.projects.find((row) => row.id === session.project_id)
    if (!project) return {}

    const author = state.users.find((row) => row.id === session.owner_user_id) ?? null
    const authorHandle =
      state.handles
        .filter((row) => row.user_id === session.owner_user_id && row.released_at === null)
        .sort((left, right) => left.handle.localeCompare(right.handle))[0]?.handle ?? null
    const ownerHandle =
      state.handles
        .filter(
          (row) =>
            row.user_id === project.owner_user_id &&
            (row.team_id ?? null) === project.owner_team_id &&
            row.released_at === null,
        )
        .sort((left, right) => left.handle.localeCompare(right.handle))[0]?.handle ?? null
    if (ownerHandle === null) return {}

    const ownerUser =
      project.owner_user_id === null
        ? null
        : (state.users.find((row) => row.id === project.owner_user_id) ?? null)
    const ownerTeam =
      project.owner_team_id === null
        ? null
        : (state.teams.find((row) => row.id === project.owner_team_id) ?? null)

    const discovery = state.hub_session_discovery.find((row) => row.sid === session.sid) ?? null
    return {
      managed_published: discovery === null ? 0 : 1,
      managed_published_at: discovery?.published_at ?? null,
      managed_author_handle: authorHandle,
      managed_author_name: author?.name ?? null,
      managed_author_display_name: author?.display_name ?? null,
      managed_author_avatar_url: author?.avatar_url ?? null,
      managed_author_custom_avatar_id: author?.custom_avatar_id ?? null,
      managed_author_avatar_visible: author?.avatar_visible ?? 1,
      managed_project_slug: project.slug,
      managed_project_name: project.name,
      managed_project_owner_user_id: project.owner_user_id,
      managed_project_owner_team_id: project.owner_team_id,
      managed_project_owner_handle: ownerHandle,
      managed_project_owner_name:
        ownerTeam?.name ??
        ownerUser?.display_name ??
        ownerUser?.name ??
        ownerUser?.email.split('@')[0] ??
        ownerHandle,
      managed_project_owner_avatar_url: ownerUser?.avatar_url ?? null,
      managed_project_owner_custom_avatar_id: ownerUser?.custom_avatar_id ?? null,
      managed_project_owner_avatar_visible: ownerUser?.avatar_visible ?? 1,
    }
  }

  function isLivePublicSession(sid: string): boolean {
    const session = state.hub_sessions.find(
      (row) => row.sid === sid && row.visibility === 'unlisted' && row.withdrawn_at === null,
    )
    if (!session || !state.hub_session_discovery.some((row) => row.sid === sid)) return false
    const author = state.users.find((row) => row.id === session.owner_user_id)
    if (!author) return false
    if (session.team_id == null) return author.deleted_at === null
    return state.teams.some(
      (row) =>
        row.id === session.team_id &&
        row.archived_at === null &&
        (row.deletion_pending_until ?? null) === null,
    )
  }

  function isLivePublicProject(projectId: string): boolean {
    return state.hub_sessions.some(
      (session) => session.project_id === projectId && isLivePublicSession(session.sid),
    )
  }

  function authorizedProjectionGateAllows(params: unknown[], offset: number): boolean {
    const [
      sid,
      root,
      updatedAt,
      visibility,
      withdrawn,
      ,
      requireAuthor,
      actorUserId,
      teamId,
      ,
      ,
      ,
      ,
      requireTeamManager,
    ] = params.slice(offset) as [
      string,
      string,
      number,
      string,
      number,
      number,
      number,
      string,
      string | null,
      string,
      string | null,
      string | null,
      string,
      number,
    ]
    const session = state.hub_sessions.find(
      (row) =>
        row.sid === sid &&
        row.root === root &&
        row.updated_at === updatedAt &&
        row.visibility === visibility &&
        (withdrawn === 1 ? row.withdrawn_at !== null : row.withdrawn_at === null),
    )
    if (!session) return false
    if (requireAuthor === 1 && session.owner_user_id !== actorUserId) return false
    if (teamId === null) return session.team_id == null && session.owner_user_id === actorUserId
    if (session.team_id !== teamId) return false
    const role = activeTeamRoleFor(teamId, actorUserId)
    return role !== null && (requireTeamManager === 0 || role === 'owner' || role === 'admin')
  }

  function prepare(sql: string) {
    const params: unknown[] = []
    const stmt = {
      bind(...args: unknown[]) {
        params.push(...args)
        return stmt
      },
      async first<T = unknown>(): Promise<T | null> {
        if (/^SELECT scheduled_at, state FROM deletion_queue WHERE user_id=\?$/i.test(sql)) {
          const [userId] = params as [string]
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          return queue
            ? ({ scheduled_at: queue.scheduled_at, state: deletionState(queue) } as T)
            : null
        }
        if (
          /^SELECT u\.deleted_at, u\.deletion_pending_until,\s+q\.scheduled_at, q\.state\s+FROM users u LEFT JOIN deletion_queue q ON q\.user_id=u\.id\s+WHERE u\.id=\?$/i.test(
            sql,
          )
        ) {
          const [userId] = params as [string]
          const user = state.users.find((row) => row.id === userId)
          if (!user) return null
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          return {
            deleted_at: user.deleted_at,
            deletion_pending_until: user.deletion_pending_until,
            scheduled_at: queue?.scheduled_at ?? null,
            state: queue ? deletionState(queue) : null,
          } as T
        }
        if (sql.includes('/* discovery:lineage-source-audience */')) {
          const [sid] = params as [string]
          const session = state.hub_sessions.find((row) => row.sid === sid)
          if (!session) return null
          return {
            team_id: session.team_id ?? null,
            visibility: session.visibility,
            withdrawn_at: session.withdrawn_at,
            published: state.hub_session_discovery.some((row) => row.sid === sid) ? 1 : 0,
          } as T
        }
        if (sql.includes('/* discovery:is-published */')) {
          const [sid] = params as [string]
          return state.hub_session_discovery.some((row) => row.sid === sid)
            ? ({ '1': 1 } as T)
            : null
        }
        if (sql.includes('/* discovery:session-live */')) {
          const [sid] = params as [string]
          const session = state.hub_sessions.find(
            (row) => row.sid === sid && row.visibility === 'unlisted' && row.withdrawn_at === null,
          )
          if (
            !session ||
            !state.hub_session_discovery.some((projection) => projection.sid === sid)
          ) {
            return null
          }
          const owner = state.users.find((row) => row.id === session.owner_user_id)
          if (!owner) return null
          const team = session.team_id
            ? state.teams.find(
                (row) =>
                  row.id === session.team_id &&
                  row.archived_at === null &&
                  row.deletion_pending_until === null,
              )
            : null
          return (session.team_id == null && owner.deleted_at === null) || team
            ? ({ '1': 1 } as T)
            : null
        }
        if (sql.includes('/* discovery:social */')) {
          const [sid, viewerUserId] = params as [string, string | null, string | null]
          if (!isLivePublicSession(sid)) return null
          const starCount = state.hub_session_stars.filter((row) => row.sid === sid).length
          const forkCount = state.hub_session_verified_forks.filter(
            (row) =>
              row.child_sid !== sid && row.source_sid === sid && isLivePublicSession(row.child_sid),
          ).length
          const viewerStarred =
            viewerUserId !== null &&
            state.hub_session_stars.some((row) => row.sid === sid && row.user_id === viewerUserId)
          return {
            star_count: starCount,
            fork_count: forkCount,
            viewer_starred: viewerStarred ? 1 : 0,
          } as T
        }
        if (/^SELECT COUNT\(\*\) AS star_count FROM hub_session_stars WHERE sid=\?$/i.test(sql)) {
          const [sid] = params as [string]
          return {
            star_count: state.hub_session_stars.filter((row) => row.sid === sid).length,
          } as T
        }
        if (
          /^SELECT COUNT\(\*\) AS count\s+FROM hub_sessions\s+WHERE project_id=\? AND withdrawn_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [projectId] = params as [string]
          return {
            count: state.hub_sessions.filter(
              (row) => row.project_id === projectId && row.withdrawn_at === null,
            ).length,
          } as T
        }
        if (
          sql.includes('SELECT COUNT(*) AS count') &&
          sql.includes('FROM hub_sessions s') &&
          sql.includes('JOIN hub_session_discovery d ON d.sid=s.sid') &&
          sql.includes('s.project_id=?') &&
          sql.includes('s.owner_user_id=?')
        ) {
          const [projectId, ownerUserId] = params as [string, string]
          return {
            count: state.hub_sessions.filter(
              (row) =>
                row.project_id === projectId &&
                row.owner_user_id === ownerUserId &&
                (row.team_id ?? null) === null &&
                row.visibility === 'unlisted' &&
                row.withdrawn_at === null &&
                state.hub_session_discovery.some((projection) => projection.sid === row.sid),
            ).length,
          } as T
        }
        if (sql.includes('/* projects:count-public-sessions */')) {
          const [projectId, ownerUserId, ownerTeamId, personal, team] = params as [
            string,
            string | null,
            string | null,
            number,
            number,
          ]
          return {
            count: state.hub_sessions.filter(
              (row) =>
                row.project_id === projectId &&
                row.visibility === 'unlisted' &&
                row.withdrawn_at === null &&
                state.hub_session_discovery.some((projection) => projection.sid === row.sid) &&
                ((personal === 1 &&
                  ownerUserId !== null &&
                  row.owner_user_id === ownerUserId &&
                  (row.team_id ?? null) === null) ||
                  (team === 1 && ownerTeamId !== null && row.team_id === ownerTeamId)),
            ).length,
          } as T
        }
        if (sql.includes('SELECT id FROM projects') && sql.includes("(id=? OR slug='sessions')")) {
          const [ownerUserId, ownerTeamId, preferredId] = params as [
            string | null,
            string | null,
            string,
            string,
          ]
          const candidates = state.projects
            .filter(
              (row) =>
                row.owner_user_id === ownerUserId &&
                row.owner_team_id === ownerTeamId &&
                row.archived_at === null &&
                (row.id === preferredId || row.slug === 'sessions'),
            )
            .sort((left, right) => {
              const preferred = Number(right.id === preferredId) - Number(left.id === preferredId)
              return (
                preferred || left.created_at - right.created_at || left.id.localeCompare(right.id)
              )
            })
          return candidates[0] ? ({ id: candidates[0].id } as T) : null
        }
        if (
          sql.includes('SELECT * FROM projects') &&
          sql.includes('owner_user_id IS ?') &&
          sql.includes('owner_team_id IS ?')
        ) {
          const [projectId, ownerUserId, ownerTeamId] = params as [
            string,
            string | null,
            string | null,
          ]
          return (activeProjectFor(projectId, ownerUserId, ownerTeamId) as T) ?? null
        }
        if (/^SELECT \* FROM projects WHERE id=\?(?: AND archived_at IS NULL)?$/i.test(sql)) {
          const [projectId] = params as [string]
          const row = state.projects.find(
            (candidate) =>
              candidate.id === projectId &&
              (!sql.includes('archived_at IS NULL') || candidate.archived_at === null),
          )
          return (row as T) ?? null
        }
        if (
          /^SELECT \* FROM projects\s+WHERE id=\? AND owner_user_id=\? AND owner_team_id IS NULL\s+AND archived_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [projectId, userId] = params as [string, string]
          return (
            (state.projects.find(
              (row) =>
                row.id === projectId &&
                row.owner_user_id === userId &&
                row.owner_team_id === null &&
                row.archived_at === null,
            ) as T) ?? null
          )
        }
        if (
          /^SELECT \* FROM projects\s+WHERE id=\? AND owner_team_id=\? AND owner_user_id IS NULL\s+AND archived_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [projectId, teamId] = params as [string, string]
          return (
            (state.projects.find(
              (row) =>
                row.id === projectId &&
                row.owner_team_id === teamId &&
                row.owner_user_id === null &&
                row.archived_at === null,
            ) as T) ?? null
          )
        }
        if (
          /^SELECT \* FROM projects WHERE (owner_user_id|owner_team_id)=\? AND slug=\? AND archived_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [, ownerColumn] =
            sql.match(/^SELECT \* FROM projects WHERE (owner_user_id|owner_team_id)=\?/i) ?? []
          const [ownerId, slug] = params as [string, string]
          return (
            (state.projects.find(
              (row) =>
                row[ownerColumn as 'owner_user_id' | 'owner_team_id'] === ownerId &&
                row.slug === slug &&
                row.archived_at === null,
            ) as T) ?? null
          )
        }
        if (
          /^SELECT 1 FROM team_memberships\s+WHERE team_id=\? AND user_id=\? AND role IN \('owner','admin'\)$/i.test(
            sql,
          )
        ) {
          const [teamId, userId] = params as [string, string]
          return state.team_memberships.some(
            (row) =>
              row.team_id === teamId &&
              row.user_id === userId &&
              (row.role === 'owner' || row.role === 'admin'),
          )
            ? ({ '1': 1 } as T)
            : null
        }
        if (
          /^SELECT project_id, request_hash\s+FROM project_creation_requests\s+WHERE actor_user_id=\? AND owner_scope=\? AND idempotency_key=\?$/i.test(
            sql,
          )
        ) {
          const [actorUserId, ownerScope, idempotencyKey] = params as [string, string, string]
          const row = state.project_creation_requests.find(
            (candidate) =>
              candidate.actor_user_id === actorUserId &&
              candidate.owner_scope === ownerScope &&
              candidate.idempotency_key === idempotencyKey,
          )
          return row ? ({ project_id: row.project_id, request_hash: row.request_hash } as T) : null
        }
        if (sql.includes('SELECT h.handle, h.user_id, h.team_id')) {
          const [handle] = params as [string]
          const claim = state.handles.find(
            (candidate) => candidate.handle === handle && candidate.released_at === null,
          )
          if (!claim) return null
          if (claim.user_id !== null) {
            const user = state.users.find(
              (candidate) =>
                candidate.id === claim.user_id &&
                candidate.deleted_at === null &&
                candidate.deletion_pending_until === null,
            )
            if (!user) return null
            return {
              handle,
              user_id: user.id,
              team_id: null,
              owner_name: null,
              owner_email: user.email,
              owner_provider_name: user.name,
              owner_display_name: user.display_name ?? null,
              owner_avatar_url: user.avatar_url,
              owner_custom_avatar_id: user.custom_avatar_id ?? null,
              owner_avatar_visible: user.avatar_visible ?? 1,
            } as T
          }
          const team = state.teams.find(
            (candidate) =>
              candidate.id === (claim.team_id ?? null) &&
              candidate.archived_at === null &&
              (candidate.deletion_pending_until ?? null) === null,
          )
          return team
            ? ({
                handle,
                user_id: null,
                team_id: team.id,
                owner_name: team.name,
                owner_email: null,
                owner_provider_name: null,
                owner_display_name: null,
                owner_avatar_url: null,
                owner_custom_avatar_id: null,
                owner_avatar_visible: null,
              } as T)
            : null
        }
        if (
          /^SELECT 1 FROM hub_sessions WHERE project_id=\? AND withdrawn_at IS NULL LIMIT 1$/i.test(
            sql,
          )
        ) {
          const [projectId] = params as [string]
          return state.hub_sessions.some(
            (row) => row.project_id === projectId && row.withdrawn_at === null,
          )
            ? ({ '1': 1 } as T)
            : null
        }
        if (
          /^SELECT COUNT\(\*\) AS count\s+FROM projects\s+WHERE owner_user_id IS \? AND owner_team_id IS \?\s+AND archived_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, ownerTeamId] = params as [string | null, string | null]
          return {
            count: state.projects.filter(
              (project) =>
                project.owner_user_id === ownerUserId &&
                project.owner_team_id === ownerTeamId &&
                project.archived_at === null,
            ).length,
          } as T
        }
        if (
          /^SELECT COUNT\(\*\) AS count\s+FROM projects\s+WHERE owner_user_id IS \? AND owner_team_id IS \?$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, ownerTeamId] = params as [string | null, string | null]
          return {
            count: state.projects.filter(
              (project) =>
                project.owner_user_id === ownerUserId && project.owner_team_id === ownerTeamId,
            ).length,
          } as T
        }
        if (
          /^SELECT COUNT\(\*\) AS count\s+FROM project_creation_requests\s+WHERE actor_user_id=\?$/i.test(
            sql,
          )
        ) {
          const [actorUserId] = params as [string]
          return {
            count: state.project_creation_requests.filter(
              (receipt) => receipt.actor_user_id === actorUserId,
            ).length,
          } as T
        }
        if (
          /^SELECT 1 FROM projects\s+WHERE id=\? AND owner_user_id IS \? AND owner_team_id IS \?\s+AND archived_at IS NULL\s+AND \(id=\? OR slug='sessions'\)\s+LIMIT 1$/i.test(
            sql,
          )
        ) {
          const [projectId, ownerUserId, ownerTeamId, defaultId] = params as [
            string,
            string | null,
            string | null,
            string,
          ]
          return state.projects.some(
            (project) =>
              project.id === projectId &&
              project.owner_user_id === ownerUserId &&
              project.owner_team_id === ownerTeamId &&
              project.archived_at === null &&
              (project.id === defaultId || project.slug === 'sessions'),
          )
            ? ({ '1': 1 } as T)
            : null
        }
        if (
          /SELECT m\.role FROM team_memberships m\s+JOIN teams t ON t\.id=m\.team_id\s+WHERE m\.team_id=\? AND m\.user_id=\?/i.test(
            sql,
          )
        ) {
          const [teamId, userId] = params as [string, string]
          const role = activeTeamRoleFor(teamId, userId)
          return role === null ? null : ({ role } as T)
        }
        if (/^SELECT role FROM team_memberships WHERE team_id=\? AND user_id=\?$/i.test(sql)) {
          const [teamId, userId] = params as [string, string]
          const role = activeTeamRoleFor(teamId, userId)
          return role === null ? null : ({ role } as T)
        }
        if (
          sql.includes('/* teams:get */ SELECT * FROM teams WHERE id=? AND archived_at IS NULL')
        ) {
          const [teamId] = params as [string]
          const team = state.teams.find((team) => team.id === teamId && team.archived_at === null)
          return team
            ? ({ ...team, deletion_pending_until: team.deletion_pending_until ?? null } as T)
            : null
        }
        if (
          sql.includes(
            '/* teams:get-membership */ SELECT * FROM team_memberships WHERE team_id=? AND user_id=?',
          )
        ) {
          const [teamId, userId] = params as [string, string]
          return (
            (state.team_memberships.find(
              (membership) => membership.team_id === teamId && membership.user_id === userId,
            ) as T) ?? null
          )
        }
        if (sql.includes('SELECT t.name') && sql.includes('FROM teams t')) {
          const [teamId] = params as [string]
          const team = state.teams.find(
            (candidate) =>
              candidate.id === teamId &&
              candidate.archived_at === null &&
              (candidate.deletion_pending_until ?? null) === null,
          )
          if (!team) return null
          const handle =
            state.handles.find(
              (candidate) =>
                (candidate.team_id ?? null) === teamId && candidate.released_at === null,
            )?.handle ?? null
          return { name: team.name, handle } as T
        }
        if (
          sql.includes('SELECT u.email, u.name, u.display_name, u.avatar_url') &&
          sql.includes('FROM users u')
        ) {
          const [userId] = params as [string]
          const user = state.users.find(
            (candidate) =>
              candidate.id === userId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          if (!user) return null
          const handle =
            state.handles.find(
              (candidate) => candidate.user_id === userId && candidate.released_at === null,
            )?.handle ?? null
          return {
            email: user.email,
            name: user.name,
            display_name: user.display_name ?? null,
            avatar_url: user.avatar_url,
            custom_avatar_id: user.custom_avatar_id ?? null,
            avatar_visible: user.avatar_visible ?? 1,
            handle,
          } as T
        }
        if (/^SELECT \* FROM hub_sessions WHERE sid=\?$/i.test(sql)) {
          const [sid] = params as [string]
          return (state.hub_sessions.find((row) => row.sid === sid) as T) ?? null
        }
        if (sql.includes('/* hub:session-guidance */')) {
          const [sid, root] = params as [string, string]
          const row = state.hub_session_guidance.find(
            (candidate) => candidate.sid === sid && candidate.root === root,
          )
          return row ? ({ guidance_json: row.guidance_json } as T) : null
        }
        if (sql.includes('/* hub:active-team-role */')) {
          const [teamId, userId] = params as [string, string]
          const role = activeTeamRoleFor(teamId, userId)
          return role === null ? null : ({ role } as T)
        }
        if (/^SELECT id, name FROM teams WHERE id=\? AND archived_at IS NULL$/i.test(sql)) {
          const [teamId] = params as [string]
          const team = state.teams.find((row) => row.id === teamId && row.archived_at === null)
          return team ? ({ id: team.id, name: team.name } as T) : null
        }
        if (/^SELECT name FROM teams WHERE id=\?$/i.test(sql)) {
          const [teamId] = params as [string]
          const team = state.teams.find((row) => row.id === teamId)
          return team ? ({ name: team.name } as T) : null
        }
        if (
          /^SELECT COUNT\(\*\) AS count FROM team_memberships m JOIN teams t ON t\.id=m\.team_id WHERE m\.user_id=\? AND m\.role='owner' AND t\.archived_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [userId] = params as [string]
          const count = state.team_memberships.filter((membership) => {
            const team = state.teams.find((candidate) => candidate.id === membership.team_id)
            return (
              membership.user_id === userId &&
              membership.role === 'owner' &&
              team?.archived_at === null
            )
          }).length
          return { count } as T
        }
        if (
          /^SELECT provider_sub FROM user_identities WHERE user_id=\? AND provider='workos'$/i.test(
            sql,
          )
        ) {
          const [userId] = params as [string]
          const identity = state.user_identities.find(
            (row) => row.user_id === userId && row.provider === 'workos',
          )
          return identity ? ({ provider_sub: identity.provider_sub } as T) : null
        }
        if (/^SELECT 1 FROM hub_team_objects WHERE pack_key LIKE \? LIMIT 1$/i.test(sql)) {
          // This legacy fake has no Team object rows. Dedicated Team storage
          // tests cover the non-empty re-homing path.
          return null
        }
        if (
          /^SELECT COALESCE\(SUM\(size\),0\) AS total FROM hub_objects WHERE owner_user_id=\?$/i.test(
            sql,
          )
        ) {
          const [ownerUserId] = params as [string]
          const total = state.hub_objects
            .filter((row) => row.owner_user_id === ownerUserId)
            .reduce((sum, row) => sum + row.size, 0)
          return { total } as T
        }
        if (
          /^SELECT COALESCE\(SUM\(size\),0\) AS total FROM hub_team_objects WHERE team_id=\?$/i.test(
            sql,
          )
        ) {
          const [teamId] = params as [string]
          const total = state.hub_team_objects
            .filter((row) => row.team_id === teamId)
            .reduce((sum, row) => sum + row.size, 0)
          return { total } as T
        }
        if (
          /^SELECT COALESCE\(SUM\(size\),0\) AS total FROM hub_objects WHERE owner_user_id=\? AND oid IN \(\?(?:,\?)*\)$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, ...oids] = params as [string, ...string[]]
          const wanted = new Set(oids)
          const total = state.hub_objects
            .filter((row) => row.owner_user_id === ownerUserId && wanted.has(row.oid))
            .reduce((sum, row) => sum + row.size, 0)
          return { total } as T
        }
        if (/^SELECT user_id FROM api_tokens WHERE token_hash=\?$/i.test(sql)) {
          const [tokenHash] = params as [string]
          const row = state.api_tokens.find((token) => token.token_hash === tokenHash)
          return row ? ({ user_id: row.user_id } as T) : null
        }
        if (/^SELECT id, user_id FROM api_tokens WHERE token_hash=\?$/i.test(sql)) {
          const [tokenHash] = params as [string]
          const row = state.api_tokens.find((token) => token.token_hash === tokenHash)
          return row ? ({ id: row.id, user_id: row.user_id } as T) : null
        }
        if (
          /^SELECT name, avatar_url, display_name, custom_avatar_id, avatar_visible FROM users WHERE id=\? AND deleted_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [id] = params as [string]
          const user = state.users.find((row) => row.id === id && row.deleted_at === null)
          if (!user) return null
          return {
            name: user.name,
            avatar_url: user.avatar_url,
            display_name: user.display_name ?? null,
            custom_avatar_id: user.custom_avatar_id ?? null,
            avatar_visible: user.avatar_visible ?? 1,
          } as T
        }
        if (sql.includes('SELECT COALESCE(display_name,name) AS label')) {
          const [userId, actorUserId] = params as [string, string]
          const user = state.users.find(
            (candidate) =>
              candidate.id === userId &&
              candidate.id === actorUserId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          return user
            ? ({
                label: user.display_name ?? user.name ?? null,
              } as T)
            : null
        }
        if (sql.includes('SELECT t.name AS label') && sql.includes('JOIN team_memberships')) {
          const [teamId, actorUserId] = params as [string, string]
          const team = state.teams.find(
            (candidate) =>
              candidate.id === teamId &&
              candidate.archived_at === null &&
              (candidate.deletion_pending_until ?? null) === null,
          )
          const role = activeTeamRoleFor(teamId, actorUserId)
          const actor = state.users.find(
            (candidate) =>
              candidate.id === actorUserId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          return team && actor && role !== null ? ({ label: team.name } as T) : null
        }
        if (
          /^SELECT u\.\* FROM users u JOIN user_identities i ON i\.user_id = u\.id WHERE i\.provider = \? AND i\.provider_sub = \?/i.test(
            sql,
          )
        ) {
          const [provider, sub] = params as [string, string]
          const link = state.user_identities.find(
            (i) => i.provider === provider && i.provider_sub === sub,
          )
          if (!link) return null
          const u = state.users.find((x) => x.id === link.user_id)
          return (u as T) ?? null
        }
        if (/^SELECT \* FROM users WHERE id=\? AND deleted_at IS NULL/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          return (u as T) ?? null
        }
        if (
          /^SELECT custom_avatar_id, avatar_visible FROM users WHERE id=\? AND deleted_at IS NULL/i.test(
            sql,
          )
        ) {
          const [id] = params
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          if (!u) return null
          return {
            custom_avatar_id: u.custom_avatar_id ?? null,
            avatar_visible: u.avatar_visible ?? 1,
          } as T
        }
        if (/^SELECT custom_avatar_id FROM users WHERE id=\?/i.test(sql)) {
          const [id] = params
          const u = state.users.find((u) => u.id === id)
          if (!u) return null
          return { custom_avatar_id: u.custom_avatar_id ?? null } as T
        }
        if (/^SELECT 1 FROM handles WHERE handle=\?$/i.test(sql)) {
          const [handle] = params as [string]
          return state.handles.some((row) => row.handle === handle) ? ({ '1': 1 } as T) : null
        }
        if (/^SELECT user_id, team_id, released_at FROM handles WHERE handle=\?$/i.test(sql)) {
          const [handle] = params as [string]
          const row = state.handles.find((candidate) => candidate.handle === handle)
          return row
            ? ({
                user_id: row.user_id,
                team_id: row.team_id ?? null,
                released_at: row.released_at,
              } as T)
            : null
        }
        if (/^SELECT 1 FROM handles WHERE handle=\? AND released_at IS NULL/i.test(sql)) {
          const [h] = params
          const row = state.handles.find((x) => x.handle === h && x.released_at === null)
          return row ? ({ '1': 1 } as T) : null
        }
        if (/^SELECT user_id FROM handles WHERE handle=\? AND released_at IS NULL/i.test(sql)) {
          const [h] = params
          const row = state.handles.find((x) => x.handle === h && x.released_at === null)
          return row ? ({ user_id: row.user_id } as T) : null
        }
        if (/^SELECT handle FROM handles WHERE user_id=\? AND released_at IS NULL/i.test(sql)) {
          const [uid] = params
          const row = state.handles.find((x) => x.user_id === uid && x.released_at === null)
          return row ? ({ handle: row.handle } as T) : null
        }
        if (/^SELECT handle FROM handles WHERE team_id=\? AND released_at IS NULL/i.test(sql)) {
          const [teamId] = params
          const row = state.handles.find(
            (candidate) => (candidate.team_id ?? null) === teamId && candidate.released_at === null,
          )
          return row ? ({ handle: row.handle } as T) : null
        }
        if (
          /^SELECT version FROM published_shares WHERE id=\? AND user_id=\? AND revoked_at IS NULL/i.test(
            sql,
          )
        ) {
          const [id, uid] = params
          const row = state.published_shares.find(
            (s) => s.id === id && s.user_id === uid && s.revoked_at === null,
          )
          return row ? ({ version: row.version } as T) : null
        }
        if (
          /^SELECT version, draft_id FROM published_shares WHERE id=\? AND user_id=\? AND revoked_at IS NULL/i.test(
            sql,
          )
        ) {
          const [id, uid] = params
          const row = state.published_shares.find(
            (s) => s.id === id && s.user_id === uid && s.revoked_at === null,
          )
          return row ? ({ version: row.version, draft_id: row.draft_id ?? null } as T) : null
        }
        if (
          /^SELECT id, version FROM published_shares WHERE user_id=\? AND client_request_id=\? AND revoked_at IS NULL/i.test(
            sql,
          )
        ) {
          const [uid, key] = params
          const row = state.published_shares.find(
            (s) => s.user_id === uid && s.client_request_id === key && s.revoked_at === null,
          )
          return row ? ({ id: row.id, version: row.version } as T) : null
        }
        if (/^SELECT revoked_at FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return row ? ({ revoked_at: row.revoked_at } as T) : null
        }
        if (
          /^SELECT visibility, revoked_at FROM published_shares WHERE id=\? AND user_id=\?/i.test(
            sql,
          )
        ) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return row ? ({ visibility: row.visibility, revoked_at: row.revoked_at } as T) : null
        }
        if (/^SELECT 1 FROM published_shares WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [id, uid] = params
          const row = state.published_shares.find((s) => s.id === id && s.user_id === uid)
          return row ? ({ '1': 1 } as T) : null
        }
        if (/^SELECT 1 FROM published_shares WHERE id=\?/i.test(sql)) {
          const [id] = params
          const row = state.published_shares.find((s) => s.id === id)
          return row ? ({ '1': 1 } as T) : null
        }
        if (
          /^SELECT 1 FROM deletion_queue WHERE user_id=\? AND cancelled=0 AND scheduled_at <= \?/i.test(
            sql,
          )
        ) {
          const [user_id, cutoff] = params as [string, number]
          const r = state.deletion_queue.find(
            (x) => x.user_id === user_id && x.cancelled === 0 && x.scheduled_at <= cutoff,
          )
          return r ? ({ '1': 1 } as T) : null
        }
        if (
          /^SELECT u\.id AS user_id, u\.email AS email, u\.name AS name, u\.avatar_url AS avatar_url, u\.display_name AS display_name, u\.custom_avatar_id AS custom_avatar_id, u\.avatar_visible AS avatar_visible FROM handles h JOIN users u ON u\.id = h\.user_id WHERE h\.handle = \? AND h\.released_at IS NULL AND u\.deleted_at IS NULL/i.test(
            sql,
          )
        ) {
          const [handle] = params as [string]
          const h = state.handles.find((x) => x.handle === handle && x.released_at === null)
          if (!h) return null
          const u = state.users.find((x) => x.id === h.user_id && x.deleted_at === null)
          if (!u) return null
          return {
            user_id: u.id,
            email: u.email,
            name: u.name,
            avatar_url: u.avatar_url,
            display_name: u.display_name ?? null,
            custom_avatar_id: u.custom_avatar_id ?? null,
            avatar_visible: u.avatar_visible ?? 1,
          } as T
        }
        throw new Error(`unmocked first() SQL: ${sql}`)
      },
      // Returns `{ success, meta: { changes } }` to mirror the real D1
      // contract — branches set `changes: 0` when their WHERE clause
      // matched nothing so optimistic-concurrency callers can detect
      // races (mirrored real D1 surfaces the same value).
      async run(): Promise<{ success: boolean; meta: { changes: number } }> {
        if (sql.includes('/* account-deletion:schedule-user */')) {
          const [until, userId] = params as [number, string]
          const user = state.users.find((row) => row.id === userId)
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          const ownsActiveTeam = state.team_memberships.some((membership) => {
            const team = state.teams.find((candidate) => candidate.id === membership.team_id)
            return (
              membership.user_id === userId &&
              membership.role === 'owner' &&
              team?.archived_at === null
            )
          })
          const canSchedule =
            user?.deleted_at === null &&
            !ownsActiveTeam &&
            (user.deletion_pending_until === null ||
              queue === undefined ||
              (deletionState(queue) !== 'pending' && deletionState(queue) !== 'processing'))
          if (!canSchedule || !user) return { success: true, meta: { changes: 0 } }
          user.deletion_pending_until = until
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* account-deletion:schedule-queue */')) {
          const [until, userId, expectedUntil] = params as [number, string, number]
          const user = state.users.find((row) => row.id === userId)
          if (!user || user.deleted_at !== null || user.deletion_pending_until !== expectedUntil) {
            return { success: true, meta: { changes: 0 } }
          }
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          if (queue && deletionState(queue) !== 'cancelled') {
            return { success: true, meta: { changes: 0 } }
          }
          const next: DeletionQueueRow = {
            user_id: userId,
            scheduled_at: until,
            cancelled: 0,
            state: 'pending',
            processing_token: null,
            processing_lease_until: null,
          }
          if (queue) Object.assign(queue, next)
          else state.deletion_queue.push(next)
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* account-deletion:cancel-user */')) {
          const [userId] = params as [string]
          const user = state.users.find((row) => row.id === userId)
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          if (
            !user ||
            user.deleted_at !== null ||
            (queue !== undefined && deletionState(queue) !== 'cancelled')
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          user.deletion_pending_until = null
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* account-deletion:claim */')) {
          const [processingToken, processingLeaseUntil, userId, cutoff, leaseCutoff] = params as [
            string,
            number,
            string,
            number,
            number,
          ]
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          const user = state.users.find((row) => row.id === userId)
          const ownsActiveTeam = state.team_memberships.some((membership) => {
            const team = state.teams.find((candidate) => candidate.id === membership.team_id)
            return (
              membership.user_id === userId &&
              membership.role === 'owner' &&
              team?.archived_at === null
            )
          })
          const claimable =
            queue !== undefined &&
            queue.scheduled_at <= cutoff &&
            queue.cancelled === 0 &&
            (deletionState(queue) === 'pending' ||
              (deletionState(queue) === 'processing' &&
                (queue.processing_lease_until ?? 0) <= leaseCutoff)) &&
            user?.deleted_at === null &&
            user.deletion_pending_until !== null &&
            !ownsActiveTeam
          if (!claimable || !queue) return { success: true, meta: { changes: 0 } }
          queue.state = 'processing'
          queue.processing_token = processingToken
          queue.processing_lease_until = processingLeaseUntil
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* account-deletion:renew-claim */')) {
          const [processingLeaseUntil, userId, processingToken] = params as [number, string, string]
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          const user = state.users.find((row) => row.id === userId)
          const ownsActiveTeam = state.team_memberships.some((membership) => {
            const team = state.teams.find((candidate) => candidate.id === membership.team_id)
            return (
              membership.user_id === userId &&
              membership.role === 'owner' &&
              team?.archived_at === null
            )
          })
          const renewable =
            queue !== undefined &&
            deletionState(queue) === 'processing' &&
            queue.cancelled === 0 &&
            queue.processing_token === processingToken &&
            user?.deleted_at === null &&
            user.deletion_pending_until !== null &&
            !ownsActiveTeam
          if (!renewable || !queue) return { success: true, meta: { changes: 0 } }
          queue.processing_lease_until = processingLeaseUntil
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^DELETE FROM deletion_queue/i.test(sql) &&
          sql.includes("state='processing'") &&
          sql.includes('processing_token=?')
        ) {
          const [userId, processingToken] = params as [string, string]
          const index = state.deletion_queue.findIndex(
            (row) =>
              row.user_id === userId &&
              deletionState(row) === 'processing' &&
              row.processing_token === processingToken,
          )
          if (index < 0) return { success: true, meta: { changes: 0 } }
          state.deletion_queue.splice(index, 1)
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM deletion_queue/i.test(sql) && sql.includes('u.deleted_at IS NOT NULL')) {
          const [userId] = params as [string]
          const user = state.users.find((row) => row.id === userId)
          const index = state.deletion_queue.findIndex((row) => row.user_id === userId)
          if (user?.deleted_at === null || user === undefined || index < 0) {
            return { success: true, meta: { changes: 0 } }
          }
          state.deletion_queue.splice(index, 1)
          return { success: true, meta: { changes: 1 } }
        }
        if (
          sql.includes('/* account-deletion:cancel-queue */') ||
          (/^UPDATE deletion_queue/i.test(sql) &&
            sql.includes("SET cancelled=1, state='cancelled'"))
        ) {
          const [userId] = params as [string]
          const queue = state.deletion_queue.find((row) => row.user_id === userId)
          if (!queue || deletionState(queue) !== 'pending' || queue.cancelled !== 0) {
            return { success: true, meta: { changes: 0 } }
          }
          queue.cancelled = 1
          queue.state = 'cancelled'
          queue.processing_token = null
          queue.processing_lease_until = null
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* discovery:authorized-upsert-projection */')) {
          const [
            sid,
            agent,
            title,
            summaryText,
            summaryTextZh,
            searchText,
            messageCount,
            toolCallCount,
            fileCount,
            additions,
            deletions,
            lineageSourceSid,
            qualityScore,
            publishedAt,
            updatedAt,
            titleJson,
            costUsd,
            totalTokens,
          ] = params as [
            string,
            SessionProvider,
            string,
            string | null,
            string | null,
            string,
            number,
            number,
            number,
            number,
            number,
            string | null,
            number,
            number,
            number,
            string | null,
            number | null,
            number | null,
          ]
          if (!authorizedProjectionGateAllows(params, 18)) {
            return { success: true, meta: { changes: 0 } }
          }
          const existing = state.hub_session_discovery.find((row) => row.sid === sid)
          if (existing) {
            Object.assign(existing, {
              agent,
              title,
              summary_text: summaryText,
              summary_text_zh: summaryTextZh,
              search_text: searchText,
              message_count: messageCount,
              tool_call_count: toolCallCount,
              file_count: fileCount,
              additions,
              deletions,
              lineage_source_sid: lineageSourceSid,
              quality_score: qualityScore,
              updated_at: updatedAt,
              title_json: titleJson,
              cost_usd: costUsd,
              total_tokens: totalTokens,
            })
          } else {
            state.hub_session_discovery.push({
              sid,
              agent,
              title,
              summary_text: summaryText,
              summary_text_zh: summaryTextZh,
              search_text: searchText,
              message_count: messageCount,
              tool_call_count: toolCallCount,
              file_count: fileCount,
              additions,
              deletions,
              lineage_source_sid: lineageSourceSid,
              quality_score: qualityScore,
              published_at: publishedAt,
              updated_at: updatedAt,
              title_json: titleJson,
              cost_usd: costUsd,
              total_tokens: totalTokens,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* discovery:authorized-delete-engagement */')) {
          const [sid] = params as [string]
          if (!authorizedProjectionGateAllows(params, 1)) {
            return { success: true, meta: { changes: 0 } }
          }
          const before = state.hub_session_engagement_daily.length
          state.hub_session_engagement_daily = state.hub_session_engagement_daily.filter(
            (row) => row.sid !== sid,
          )
          return {
            success: true,
            meta: { changes: before - state.hub_session_engagement_daily.length },
          }
        }
        if (sql.includes('/* discovery:authorized-delete-target-stars */')) {
          const [sid] = params as [string]
          if (!authorizedProjectionGateAllows(params, 1)) {
            return { success: true, meta: { changes: 0 } }
          }
          const before = state.hub_session_stars.length
          state.hub_session_stars = state.hub_session_stars.filter((row) => row.sid !== sid)
          return {
            success: true,
            meta: { changes: before - state.hub_session_stars.length },
          }
        }
        if (sql.includes('/* discovery:authorized-delete-project-stars-when-not-public */')) {
          const [projectId] = params as [string]
          if (!authorizedProjectionGateAllows(params, 2) || isLivePublicProject(projectId)) {
            return { success: true, meta: { changes: 0 } }
          }
          const before = state.project_stars.length
          state.project_stars = state.project_stars.filter(
            (relation) => relation.project_id !== projectId,
          )
          return {
            success: true,
            meta: { changes: before - state.project_stars.length },
          }
        }
        if (
          sql.includes('/* discovery:authorized-delete-project-outsider-watches-when-not-public */')
        ) {
          const [projectId] = params as [string]
          if (!authorizedProjectionGateAllows(params, 2) || isLivePublicProject(projectId)) {
            return { success: true, meta: { changes: 0 } }
          }
          const project = state.projects.find(
            (candidate) => candidate.id === projectId && candidate.archived_at === null,
          )
          const before = state.project_watches.length
          state.project_watches = state.project_watches.filter((relation) => {
            if (relation.project_id !== projectId) return true
            if (project?.owner_team_id === null || project?.owner_team_id === undefined) {
              return false
            }
            return activeTeamRoleFor(project.owner_team_id, relation.user_id) !== null
          })
          return {
            success: true,
            meta: { changes: before - state.project_watches.length },
          }
        }
        if (sql.includes('/* discovery:authorized-delete-projection */')) {
          const [sid] = params as [string]
          if (!authorizedProjectionGateAllows(params, 1)) {
            return { success: true, meta: { changes: 0 } }
          }
          const before = state.hub_session_discovery.length
          state.hub_session_discovery = state.hub_session_discovery.filter((row) => row.sid !== sid)
          return { success: true, meta: { changes: before - state.hub_session_discovery.length } }
        }
        if (sql.includes('/* discovery:upsert-projection */')) {
          const [
            sid,
            agent,
            title,
            summaryText,
            summaryTextZh,
            searchText,
            messageCount,
            toolCallCount,
            fileCount,
            additions,
            deletions,
            lineageSourceSid,
            qualityScore,
            publishedAt,
            updatedAt,
            titleJson,
            costUsd,
            totalTokens,
          ] = params as [
            string,
            SessionProvider,
            string,
            string | null,
            string | null,
            string,
            number,
            number,
            number,
            number,
            number,
            string | null,
            number,
            number,
            number,
            string | null,
            number | null,
            number | null,
          ]
          const existing = state.hub_session_discovery.find((row) => row.sid === sid)
          if (existing) {
            Object.assign(existing, {
              agent,
              title,
              summary_text: summaryText,
              summary_text_zh: summaryTextZh,
              search_text: searchText,
              message_count: messageCount,
              tool_call_count: toolCallCount,
              file_count: fileCount,
              additions,
              deletions,
              lineage_source_sid: lineageSourceSid,
              quality_score: qualityScore,
              updated_at: updatedAt,
              title_json: titleJson,
              cost_usd: costUsd,
              total_tokens: totalTokens,
            })
          } else {
            state.hub_session_discovery.push({
              sid,
              agent,
              title,
              summary_text: summaryText,
              summary_text_zh: summaryTextZh,
              search_text: searchText,
              message_count: messageCount,
              tool_call_count: toolCallCount,
              file_count: fileCount,
              additions,
              deletions,
              lineage_source_sid: lineageSourceSid,
              quality_score: qualityScore,
              published_at: publishedAt,
              updated_at: updatedAt,
              title_json: titleJson,
              cost_usd: costUsd,
              total_tokens: totalTokens,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* discovery:increment-engagement-if-live */')) {
          const [day, sid] = params as [string, string]
          const session = state.hub_sessions.find(
            (row) => row.sid === sid && row.visibility === 'unlisted' && row.withdrawn_at === null,
          )
          const owner = session
            ? state.users.find((row) => row.id === session.owner_user_id)
            : undefined
          const team = session?.team_id
            ? state.teams.find(
                (row) =>
                  row.id === session.team_id &&
                  row.archived_at === null &&
                  row.deletion_pending_until === null,
              )
            : null
          const live =
            session !== undefined &&
            owner !== undefined &&
            state.hub_session_discovery.some((projection) => projection.sid === sid) &&
            ((session.team_id == null && owner.deleted_at === null) || team !== null)
          if (!live) return { success: true, meta: { changes: 0 } }
          const existing = state.hub_session_engagement_daily.find(
            (row) => row.sid === sid && row.day === day,
          )
          if (existing) existing.qualified_reads += 1
          else state.hub_session_engagement_daily.push({ sid, day, qualified_reads: 1 })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* discovery:add-star-if-live */')) {
          const [createdAt, userId, sid] = params as [number, string, string]
          const viewer = state.users.find(
            (row) =>
              row.id === userId && row.deleted_at === null && row.deletion_pending_until === null,
          )
          if (!viewer || !isLivePublicSession(sid)) {
            return { success: true, meta: { changes: 0 } }
          }
          if (state.hub_session_stars.some((row) => row.sid === sid && row.user_id === userId)) {
            return { success: true, meta: { changes: 0 } }
          }
          state.hub_session_stars.push({ sid, user_id: userId, created_at: createdAt })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* discovery:delete-star-if-live */')) {
          const [sid, userId] = params as [string, string]
          if (!isLivePublicSession(sid)) {
            return { success: true, meta: { changes: 0 } }
          }
          const before = state.hub_session_stars.length
          state.hub_session_stars = state.hub_session_stars.filter(
            (row) => row.sid !== sid || row.user_id !== userId,
          )
          return { success: true, meta: { changes: before - state.hub_session_stars.length } }
        }
        if (sql.includes('/* hub:create-resume-grant */')) {
          const [
            tokenHash,
            position,
            createdAt,
            expiresAt,
            sid,
            root,
            updatedAt,
            minimumCount,
            expectedUnlistedTeamId,
            expectedTeamId,
            teamViewerUserId,
          ] = params as [
            string,
            number,
            number,
            number,
            string,
            string,
            number,
            number,
            string | null,
            string | null,
            string | null,
            string | null,
          ]
          const session = state.hub_sessions.find(
            (row) =>
              row.sid === sid &&
              row.root === root &&
              row.updated_at === updatedAt &&
              row.record_count >= minimumCount &&
              row.withdrawn_at === null,
          )
          const readable =
            session !== undefined &&
            ((session.visibility === 'unlisted' &&
              (session.team_id ?? null) === expectedUnlistedTeamId) ||
              (session.visibility === 'private' &&
                (session.team_id ?? null) === expectedTeamId &&
                teamViewerUserId !== null &&
                expectedTeamId !== null &&
                activeTeamRoleFor(expectedTeamId, teamViewerUserId) !== null))
          if (
            !readable ||
            state.hub_session_resume_grants.some((row) => row.token_hash === tokenHash)
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          state.hub_session_resume_grants.push({
            token_hash: tokenHash,
            source_sid: sid,
            source_root: root,
            source_position: position,
            created_at: createdAt,
            expires_at: expiresAt,
            claimed_child_sid: null,
            claimed_child_root: null,
            claimed_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:delete-expired-resume-grants */')) {
          const [now] = params as [number]
          const before = state.hub_session_resume_grants.length
          state.hub_session_resume_grants = state.hub_session_resume_grants.filter(
            (row) => row.claimed_child_sid !== null || row.expires_at >= now,
          )
          return {
            success: true,
            meta: { changes: before - state.hub_session_resume_grants.length },
          }
        }
        if (sql.includes('/* hub:claim-verified-fork */')) {
          const [
            verifiedAt,
            childSid,
            tokenHash,
            sourceSid,
            sourcePosition,
            minimumExpiry,
            childOwnerUserId,
            childRoot,
            childCreatedAt,
            childUpdatedAt,
            audienceTeamId,
          ] = params as [
            number,
            string,
            string,
            string,
            number,
            number,
            string,
            string,
            number,
            number,
            string | null,
            string | null,
            string | null,
            string | null,
          ]
          const grant = state.hub_session_resume_grants.find(
            (row) =>
              row.token_hash === tokenHash &&
              row.source_sid === sourceSid &&
              row.source_position === sourcePosition &&
              row.expires_at >= minimumExpiry &&
              row.claimed_child_sid === null,
          )
          const source = state.hub_sessions.find((row) => row.sid === sourceSid)
          const child = state.hub_sessions.find((row) => row.sid === childSid)
          const sourceAudience =
            source !== undefined &&
            (audienceTeamId === null
              ? source.visibility === 'unlisted' &&
                source.withdrawn_at === null &&
                state.hub_session_discovery.some((row) => row.sid === sourceSid)
              : child?.visibility === 'private' &&
                child.team_id === audienceTeamId &&
                source.team_id === audienceTeamId &&
                source.withdrawn_at === null)
          const eligible =
            grant !== undefined &&
            source !== undefined &&
            child !== undefined &&
            child.sid !== source.sid &&
            child.owner_user_id === childOwnerUserId &&
            child.root === childRoot &&
            child.created_at === childCreatedAt &&
            child.updated_at === childUpdatedAt &&
            child.withdrawn_at === null &&
            grant.source_position <= source.record_count &&
            sourceAudience
          if (
            !eligible ||
            state.hub_session_verified_forks.some(
              (row) => row.child_sid === childSid || row.grant_token_hash === tokenHash,
            )
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          state.hub_session_verified_forks.push({
            child_sid: childSid,
            source_sid: sourceSid,
            source_root: grant.source_root,
            source_position: sourcePosition,
            child_root: childRoot,
            grant_token_hash: tokenHash,
            verified_at: verifiedAt,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:mark-resume-grant-claimed */')) {
          const [childSid, childRoot, claimedAt, tokenHash] = params as [
            string,
            string,
            number,
            string,
            string,
            string,
          ]
          const grant = state.hub_session_resume_grants.find(
            (row) => row.token_hash === tokenHash && row.claimed_child_sid === null,
          )
          const relation = state.hub_session_verified_forks.find(
            (row) =>
              row.grant_token_hash === tokenHash &&
              row.child_sid === childSid &&
              row.child_root === childRoot,
          )
          if (!grant || !relation) return { success: true, meta: { changes: 0 } }
          grant.claimed_child_sid = childSid
          grant.claimed_child_root = childRoot
          grant.claimed_at = claimedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:upsert-session-guidance-projection */')) {
          const [
            sid,
            root,
            guidanceJson,
            generatedAt,
            gateSid,
            ownerUserId,
            gateRoot,
            viewOid,
            updatedAt,
          ] = params as [string, string, string, number, string, string, string, string, number]
          const session = state.hub_sessions.find(
            (row) =>
              row.sid === gateSid &&
              row.owner_user_id === ownerUserId &&
              row.root === gateRoot &&
              row.view_oid === viewOid &&
              row.updated_at === updatedAt &&
              row.withdrawn_at === null,
          )
          if (!session) return { success: true, meta: { changes: 0 } }
          const existing = state.hub_session_guidance.find((row) => row.sid === sid)
          if (existing) {
            existing.root = root
            existing.guidance_json = guidanceJson
            existing.generated_at = generatedAt
          } else {
            state.hub_session_guidance.push({
              sid,
              root,
              guidance_json: guidanceJson,
              generated_at: generatedAt,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:delete-session-guidance-projection */')) {
          const [sid, gateSid, ownerUserId, root, viewOid, updatedAt] = params as [
            string,
            string,
            string,
            string,
            string,
            number,
          ]
          const session = state.hub_sessions.find(
            (row) =>
              row.sid === gateSid &&
              row.owner_user_id === ownerUserId &&
              row.root === root &&
              row.view_oid === viewOid &&
              row.updated_at === updatedAt &&
              row.withdrawn_at === null,
          )
          if (!session) return { success: true, meta: { changes: 0 } }
          const before = state.hub_session_guidance.length
          state.hub_session_guidance = state.hub_session_guidance.filter((row) => row.sid !== sid)
          return {
            success: true,
            meta: { changes: before - state.hub_session_guidance.length },
          }
        }
        if (sql.includes('/* projects:authorized-create */')) {
          const [
            projectId,
            ownerUserId,
            ownerTeamId,
            slug,
            name,
            description,
            githubUrl,
            createdByUserId,
            createdAt,
            updatedAt,
            actorUserId,
          ] = params as [
            string,
            string | null,
            string | null,
            string,
            string,
            string | null,
            string | null,
            string,
            number,
            number,
            string,
          ]
          const actor = state.users.find(
            (row) =>
              row.id === actorUserId &&
              row.deleted_at === null &&
              row.deletion_pending_until === null,
          )
          const authorized =
            actor !== undefined &&
            (ownerTeamId === null
              ? ownerUserId === actorUserId
              : ['owner', 'admin'].includes(activeTeamRoleFor(ownerTeamId, actorUserId) ?? ''))
          const hasHandle = state.handles.some(
            (row) =>
              row.released_at === null &&
              row.user_id === ownerUserId &&
              (row.team_id ?? null) === ownerTeamId,
          )
          if (!authorized || !hasHandle) return { success: true, meta: { changes: 0 } }
          if (
            state.projects.filter(
              (row) =>
                row.owner_user_id === ownerUserId &&
                row.owner_team_id === ownerTeamId &&
                row.archived_at === null,
            ).length >= 100
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (
            state.projects.filter(
              (row) => row.owner_user_id === ownerUserId && row.owner_team_id === ownerTeamId,
            ).length >= 1_000
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          const receiptRequired = params.at(-3) !== null
          const receiptActorUserId = params.at(-2) as string
          const receiptLimit = params.at(-1) as number
          if (
            receiptRequired &&
            state.project_creation_requests.filter(
              (receipt) => receipt.actor_user_id === receiptActorUserId,
            ).length >= receiptLimit
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (
            state.projects.some(
              (row) =>
                row.id === projectId ||
                (row.owner_user_id === ownerUserId &&
                  row.owner_team_id === ownerTeamId &&
                  row.slug === slug &&
                  row.archived_at === null),
            )
          ) {
            throw new Error('UNIQUE constraint failed: projects.owner, projects.slug')
          }
          state.projects.push({
            id: projectId,
            owner_user_id: ownerUserId,
            owner_team_id: ownerTeamId,
            slug,
            name,
            description,
            github_url: githubUrl,
            created_by_user_id: createdByUserId,
            created_at: createdAt,
            updated_at: updatedAt,
            archived_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* projects:record-idempotent-create */')) {
          const [
            actorUserId,
            ownerScope,
            ownerUserId,
            ownerTeamId,
            idempotencyKey,
            projectId,
            requestHash,
            createdAt,
          ] = params as [
            string,
            string,
            string | null,
            string | null,
            string,
            string,
            string,
            number,
          ]
          const project = activeProjectFor(projectId, ownerUserId, ownerTeamId)
          if (!project) return { success: true, meta: { changes: 0 } }
          const receiptActorUserId = params[11] as string
          const receiptLimit = params[12] as number
          if (
            state.project_creation_requests.filter(
              (receipt) => receipt.actor_user_id === receiptActorUserId,
            ).length >= receiptLimit
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (
            state.project_creation_requests.some(
              (row) =>
                (row.actor_user_id === actorUserId &&
                  row.owner_scope === ownerScope &&
                  row.idempotency_key === idempotencyKey) ||
                row.project_id === projectId,
            )
          ) {
            throw new Error(
              'UNIQUE constraint failed: project_creation_requests.actor_user_id, project_creation_requests.owner_scope, project_creation_requests.idempotency_key',
            )
          }
          state.project_creation_requests.push({
            actor_user_id: actorUserId,
            owner_scope: ownerScope,
            owner_user_id: ownerUserId,
            owner_team_id: ownerTeamId,
            idempotency_key: idempotencyKey,
            project_id: projectId,
            request_hash: requestHash,
            created_at: createdAt,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* projects:authorized-update */')) {
          const [
            hasName,
            name,
            hasSlug,
            slug,
            hasDescription,
            description,
            hasGithubUrl,
            githubUrl,
            hasArchived,
            archived,
            archivedAt,
            updatedAt,
            projectId,
            ownerUserId,
            ownerTeamId,
            hasExpectedUpdatedAt,
            expectedUpdatedAt,
            archiveRequested,
            fallbackArchiveRequested,
            defaultProjectId,
            actorUserId,
          ] = params as [
            number,
            string,
            number,
            string,
            number,
            string | null,
            number,
            string | null,
            number,
            number,
            number,
            number,
            string,
            string | null,
            string | null,
            number,
            number,
            number,
            number,
            string,
            string,
          ]
          const project = activeProjectFor(projectId, ownerUserId, ownerTeamId)
          const actor = state.users.find(
            (row) =>
              row.id === actorUserId &&
              row.deleted_at === null &&
              row.deletion_pending_until === null,
          )
          const authorized =
            actor !== undefined &&
            (ownerTeamId === null
              ? ownerUserId === actorUserId
              : ['owner', 'admin'].includes(activeTeamRoleFor(ownerTeamId, actorUserId) ?? ''))
          if (
            !project ||
            !authorized ||
            (hasExpectedUpdatedAt === 1 && project.updated_at !== expectedUpdatedAt) ||
            (archiveRequested === 1 &&
              state.hub_sessions.some(
                (row) => row.project_id === projectId && row.withdrawn_at === null,
              )) ||
            (fallbackArchiveRequested === 1 &&
              (project.id === defaultProjectId || project.slug === 'sessions'))
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          const nextSlug = hasSlug === 1 ? slug : project.slug
          if (
            state.projects.some(
              (row) =>
                row.id !== projectId &&
                row.owner_user_id === ownerUserId &&
                row.owner_team_id === ownerTeamId &&
                row.slug === nextSlug &&
                row.archived_at === null,
            )
          ) {
            throw new Error('UNIQUE constraint failed: projects.owner, projects.slug')
          }
          if (hasName === 1) project.name = name
          if (hasSlug === 1) project.slug = slug
          if (hasDescription === 1) project.description = description
          if (hasGithubUrl === 1) project.github_url = githubUrl
          if (hasArchived === 1) project.archived_at = archived === 1 ? archivedAt : null
          project.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* projects:authorized-default */')) {
          const [projectId, ownerUserId, ownerTeamId, actorUserId, createdAt, updatedAt] =
            params as [string, string | null, string | null, string, number, number]
          if (state.projects.some((row) => row.id === projectId)) {
            return { success: true, meta: { changes: 0 } }
          }
          const actor = state.users.find(
            (row) =>
              row.id === actorUserId &&
              row.deleted_at === null &&
              row.deletion_pending_until === null,
          )
          const authorized =
            actor !== undefined &&
            (ownerTeamId === null
              ? ownerUserId === actorUserId
              : activeTeamRoleFor(ownerTeamId, actorUserId) !== null)
          if (!authorized) return { success: true, meta: { changes: 0 } }
          if (
            state.projects.filter(
              (row) =>
                row.owner_user_id === ownerUserId &&
                row.owner_team_id === ownerTeamId &&
                row.archived_at === null,
            ).length >= 100
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (
            state.projects.filter(
              (row) => row.owner_user_id === ownerUserId && row.owner_team_id === ownerTeamId,
            ).length >= 1_000
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          state.projects.push({
            id: projectId,
            owner_user_id: ownerUserId,
            owner_team_id: ownerTeamId,
            slug: 'sessions',
            name: 'Sessions',
            description:
              'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
            github_url: null,
            created_by_user_id: actorUserId,
            created_at: createdAt,
            updated_at: updatedAt,
            archived_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:authorized-head-insert */')) {
          const [
            sid,
            ownerUserId,
            root,
            recordCount,
            sig,
            cardJson,
            summaryMd,
            lineageJson,
            viewOid,
            spoolFileOid,
            costUsd,
            totalTokens,
            targetVisibility,
            targetTeamId,
            targetProjectId,
            createdAt,
            updatedAt,
            actorUserId,
            ,
            ,
            ,
            requireTeamManager,
          ] = params as [
            string,
            string,
            string,
            number,
            string | null,
            string | null,
            string | null,
            string | null,
            string,
            string | null,
            number | null,
            number | null,
            string,
            string | null,
            string,
            number,
            number,
            string,
            string | null,
            string | null,
            string,
            number,
          ]
          const actor = state.users.find((row) => row.id === actorUserId)
          if (!actor || actor.deleted_at !== null || actor.deletion_pending_until !== null) {
            return { success: true, meta: { changes: 0 } }
          }
          if (targetTeamId !== null) {
            const role = activeTeamRoleFor(targetTeamId, actorUserId)
            if (
              role === null ||
              (requireTeamManager === 1 && role !== 'owner' && role !== 'admin') ||
              actor.deleted_at !== null ||
              actor.deletion_pending_until !== null
            ) {
              return { success: true, meta: { changes: 0 } }
            }
          }
          if (
            !activeProjectFor(
              targetProjectId,
              targetTeamId === null ? actorUserId : null,
              targetTeamId,
            )
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (state.hub_sessions.some((row) => row.sid === sid)) {
            throw new Error('UNIQUE constraint failed: hub_sessions.sid')
          }
          state.hub_sessions.push({
            sid,
            owner_user_id: ownerUserId,
            root,
            record_count: recordCount,
            sig,
            card_json: cardJson,
            note_md: summaryMd,
            lineage_json: lineageJson,
            view_oid: viewOid,
            spool_file_oid: spoolFileOid,
            cost_usd: costUsd,
            total_tokens: totalTokens,
            visibility: targetVisibility,
            team_id: targetTeamId,
            project_id: targetProjectId,
            withdrawn_at: null,
            created_at: createdAt,
            updated_at: updatedAt,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:authorized-head-update */')) {
          const root = params[0] as string
          const recordCount = params[1] as number
          const sig = params[2] as string | null
          const cardJson = params[3] as string | null
          const summaryMd = params[4] as string | null
          const lineageJson = params[5] as string | null
          const viewOid = params[6] as string
          const spoolFileOid = params[7] as string | null
          const costUsd = params[8] as number | null
          const totalTokens = params[9] as number | null
          const changeAccess = params[10] as number
          const targetVisibility = params[11] as string
          const targetTeamId = params[13] as string | null
          const changeProject = params[14] as number
          const targetProjectId = params[15] as string
          const clearWithdrawal = params[16] as number
          const updatedAt = params[17] as number
          const sid = params[18] as string
          const actorUserId = params[19] as string
          const expectedRoot = params[20] as string | null
          const expectedUpdatedAt = params[21] as number | null
          const expectedTeamId = params[22] as string | null
          const expectedProjectId = params[23] as string | null
          const expectedVisibility = params[24] as string
          const expectedWithdrawnAt = params[25] as number | null
          const expectedPublished = params[26] as number
          const requireTeamManager = params[32] as number
          const actor = state.users.find((row) => row.id === actorUserId)
          if (!actor || actor.deleted_at !== null || actor.deletion_pending_until !== null) {
            return { success: true, meta: { changes: 0 } }
          }
          if (targetTeamId !== null) {
            const role = activeTeamRoleFor(targetTeamId, actorUserId)
            if (
              role === null ||
              (requireTeamManager === 1 && role !== 'owner' && role !== 'admin') ||
              actor.deleted_at !== null ||
              actor.deletion_pending_until !== null
            ) {
              return { success: true, meta: { changes: 0 } }
            }
          }
          if (
            !activeProjectFor(
              targetProjectId,
              targetTeamId === null ? actorUserId : null,
              targetTeamId,
            )
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          const existing = state.hub_sessions.find((row) => row.sid === sid)
          if (!existing) return { success: true, meta: { changes: 0 } }
          const isPublished = state.hub_session_discovery.some((row) => row.sid === sid)
          if (
            existing.owner_user_id !== actorUserId ||
            existing.root !== expectedRoot ||
            existing.updated_at !== expectedUpdatedAt ||
            (existing.team_id ?? null) !== expectedTeamId ||
            (existing.project_id ?? null) !== expectedProjectId ||
            existing.visibility !== expectedVisibility ||
            existing.withdrawn_at !== expectedWithdrawnAt ||
            isPublished !== (expectedPublished === 1)
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          existing.root = root
          existing.record_count = recordCount
          existing.sig = sig
          existing.card_json = cardJson
          existing.note_md = summaryMd
          existing.lineage_json = lineageJson
          existing.view_oid = viewOid
          existing.spool_file_oid = spoolFileOid
          existing.cost_usd = costUsd
          existing.total_tokens = totalTokens
          if (changeAccess === 1) {
            existing.visibility = targetVisibility
            existing.team_id = targetTeamId
          }
          if (changeProject === 1) existing.project_id = targetProjectId
          if (clearWithdrawal === 1) existing.withdrawn_at = null
          existing.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:authorized-visibility-update */')) {
          const targetVisibility = params[0] as string
          const targetTeamId = params[1] as string | null
          const targetProjectId = params[2] as string
          const lineageJson = params[3] as string | null
          const updatedAt = params[4] as number
          const sid = params[5] as string
          const expectedTeamId = params[6] as string | null
          const expectedProjectId = params[7] as string
          const expectedVisibility = params[8] as string
          const expectedRoot = params[9] as string
          const expectedUpdatedAt = params[10] as number
          const actorUserId = params[11] as string
          const expectedPublished = params[12] as number
          const requireTargetManager = params[22] as number
          const session = state.hub_sessions.find((row) => row.sid === sid)
          const isPublished = state.hub_session_discovery.some((row) => row.sid === sid)
          const actor = state.users.find((row) => row.id === actorUserId)
          if (
            !session ||
            !actor ||
            actor.deleted_at !== null ||
            actor.deletion_pending_until !== null ||
            (session.team_id ?? null) !== expectedTeamId ||
            session.project_id !== expectedProjectId ||
            session.visibility !== expectedVisibility ||
            session.root !== expectedRoot ||
            session.updated_at !== expectedUpdatedAt ||
            session.withdrawn_at !== null ||
            isPublished !== (expectedPublished === 1)
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          if (expectedTeamId === null) {
            if (session.owner_user_id !== actorUserId) {
              return { success: true, meta: { changes: 0 } }
            }
          } else {
            const role = activeTeamRoleFor(expectedTeamId, actorUserId)
            if (
              (role !== 'owner' && role !== 'admin') ||
              actor.deleted_at !== null ||
              actor.deletion_pending_until !== null
            ) {
              return { success: true, meta: { changes: 0 } }
            }
          }
          if (targetTeamId !== null) {
            const role = activeTeamRoleFor(targetTeamId, actorUserId)
            if (
              role === null ||
              (requireTargetManager === 1 && role !== 'owner' && role !== 'admin') ||
              actor.deleted_at !== null ||
              actor.deletion_pending_until !== null
            ) {
              return { success: true, meta: { changes: 0 } }
            }
          }
          if (
            !activeProjectFor(
              targetProjectId,
              targetTeamId === null ? actorUserId : null,
              targetTeamId,
            )
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          session.visibility = targetVisibility
          session.team_id = targetTeamId
          session.project_id = targetProjectId
          session.lineage_json = lineageJson
          session.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:authorized-withdraw */')) {
          const [withdrawnAt, updatedAt, sid, expectedTeamId, , actorUserId] = params as [
            number,
            number,
            string,
            string | null,
            string | null,
            string,
          ]
          const session = state.hub_sessions.find(
            (row) => row.sid === sid && (row.team_id ?? null) === expectedTeamId,
          )
          if (!session) return { success: true, meta: { changes: 0 } }
          if (expectedTeamId === null) {
            if (session.owner_user_id !== actorUserId) {
              return { success: true, meta: { changes: 0 } }
            }
          } else {
            const role = activeTeamRoleFor(expectedTeamId, actorUserId)
            if (role !== 'owner' && role !== 'admin') {
              return { success: true, meta: { changes: 0 } }
            }
          }
          session.withdrawn_at ??= withdrawnAt
          session.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^INSERT INTO hub_sessions \(sid, owner_user_id, root, record_count, sig, card_json, note_md, lineage_json, view_oid, spool_file_oid, cost_usd, total_tokens, visibility, withdrawn_at, created_at, updated_at\) VALUES \(\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,\?,'unlisted',NULL,\?,\?\) ON CONFLICT\(sid\) DO UPDATE SET root=excluded\.root, record_count=excluded\.record_count, sig=excluded\.sig, card_json=excluded\.card_json, note_md=excluded\.note_md, lineage_json=excluded\.lineage_json, view_oid=excluded\.view_oid, spool_file_oid=excluded\.spool_file_oid, cost_usd=excluded\.cost_usd, total_tokens=excluded\.total_tokens, withdrawn_at=NULL, updated_at=excluded\.updated_at$/i.test(
            sql,
          )
        ) {
          const [
            sid,
            ownerUserId,
            root,
            recordCount,
            sig,
            cardJson,
            summaryMd,
            lineageJson,
            viewOid,
            spoolFileOid,
            costUsd,
            totalTokens,
            createdAt,
            updatedAt,
          ] = params as [
            string,
            string,
            string,
            number,
            string | null,
            string | null,
            string | null,
            string | null,
            string,
            string | null,
            number | null,
            number | null,
            number,
            number,
          ]
          const existing = state.hub_sessions.find((row) => row.sid === sid)
          if (existing) {
            existing.root = root
            existing.record_count = recordCount
            existing.sig = sig
            existing.card_json = cardJson
            existing.note_md = summaryMd
            existing.lineage_json = lineageJson
            existing.view_oid = viewOid
            existing.spool_file_oid = spoolFileOid
            existing.cost_usd = costUsd
            existing.total_tokens = totalTokens
            existing.withdrawn_at = null
            existing.updated_at = updatedAt
          } else {
            state.hub_sessions.push({
              sid,
              owner_user_id: ownerUserId,
              root,
              record_count: recordCount,
              sig,
              card_json: cardJson,
              note_md: summaryMd,
              lineage_json: lineageJson,
              view_oid: viewOid,
              spool_file_oid: spoolFileOid,
              cost_usd: costUsd,
              total_tokens: totalTokens,
              visibility: 'unlisted',
              team_id: null,
              withdrawn_at: null,
              created_at: createdAt,
              updated_at: updatedAt,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE hub_sessions SET visibility=\?, team_id=\?, updated_at=\? WHERE sid=\?$/i.test(
            sql,
          )
        ) {
          const [visibility, teamId, updatedAt, sid] = params as [
            string,
            string | null,
            number,
            string,
          ]
          const row = state.hub_sessions.find((session) => session.sid === sid)
          if (!row) return { success: true, meta: { changes: 0 } }
          row.visibility = visibility
          row.team_id = teamId
          row.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE hub_sessions SET withdrawn_at=\?, updated_at=\? WHERE sid=\? AND owner_user_id=\?$/i.test(
            sql,
          )
        ) {
          const [withdrawnAt, updatedAt, sid, ownerUserId] = params as [
            number,
            number,
            string,
            string,
          ]
          const row = state.hub_sessions.find(
            (session) => session.sid === sid && session.owner_user_id === ownerUserId,
          )
          if (!row) return { success: true, meta: { changes: 0 } }
          row.withdrawn_at = withdrawnAt
          row.updated_at = updatedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE hub_sessions SET withdrawn_at=\?, updated_at=\? WHERE owner_user_id=\? AND team_id IS NULL AND withdrawn_at IS NULL$/i.test(
            sql,
          )
        ) {
          const [withdrawnAt, updatedAt, ownerUserId] = params as [number, number, string]
          let changes = 0
          for (const row of state.hub_sessions) {
            if (
              row.owner_user_id !== ownerUserId ||
              row.team_id != null ||
              row.withdrawn_at !== null
            )
              continue
            row.withdrawn_at = withdrawnAt
            row.updated_at = updatedAt
            changes += 1
          }
          return { success: true, meta: { changes } }
        }
        if (
          /^INSERT OR IGNORE INTO hub_objects \(owner_user_id, oid, size, pack_key, offset, length, created_at\) VALUES \(\?,\?,\?,\?,\?,\?,\?\)$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, oid, size, packKey, offset, length, createdAt] = params as [
            string,
            string,
            number,
            string,
            number,
            number,
            number,
          ]
          const duplicate = state.hub_objects.some(
            (row) => row.owner_user_id === ownerUserId && row.oid === oid,
          )
          if (duplicate) return { success: true, meta: { changes: 0 } }
          state.hub_objects.push({
            owner_user_id: ownerUserId,
            oid,
            size,
            pack_key: packKey,
            offset,
            length,
            created_at: createdAt,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* hub:authorized-team-alias-after-commit */')) {
          const [teamId, createdAt, ownerUserId] = params as [string, number, string]
          const [
            sid,
            gateOwnerUserId,
            gateTeamId,
            root,
            updatedAt,
            visibility,
            actorUserId,
            manager,
          ] = params.slice(-8) as [string, string, string, string, number, string, string, number]
          const oids = params.slice(3, -8) as string[]
          const session = state.hub_sessions.find((row) => row.sid === sid)
          const role = activeTeamRoleFor(gateTeamId, actorUserId)
          const actor = state.users.find((row) => row.id === actorUserId)
          if (
            !session ||
            teamId !== gateTeamId ||
            ownerUserId !== gateOwnerUserId ||
            session.owner_user_id !== gateOwnerUserId ||
            session.team_id !== gateTeamId ||
            session.root !== root ||
            session.updated_at !== updatedAt ||
            session.visibility !== visibility ||
            session.withdrawn_at !== null ||
            role === null ||
            (manager === 1 && role !== 'owner' && role !== 'admin') ||
            !actor ||
            actor.deleted_at !== null ||
            actor.deletion_pending_until !== null
          ) {
            return { success: true, meta: { changes: 0 } }
          }
          const wanted = new Set(oids)
          const additions = state.hub_objects.filter(
            (object) =>
              object.owner_user_id === ownerUserId &&
              wanted.has(object.oid) &&
              !state.hub_team_objects.some(
                (candidate) => candidate.team_id === teamId && candidate.oid === object.oid,
              ),
          )
          const used = state.hub_team_objects
            .filter((row) => row.team_id === teamId)
            .reduce((total, row) => total + row.size, 0)
          const incoming = additions.reduce((total, row) => total + row.size, 0)
          if (used + incoming > 5 * 1024 * 1024 * 1024) {
            throw new Error('team storage quota exceeded')
          }
          for (const object of additions) {
            state.hub_team_objects.push({
              team_id: teamId,
              oid: object.oid,
              size: object.size,
              pack_key: object.pack_key,
              offset: object.offset,
              length: object.length,
              created_at: createdAt,
            })
          }
          return { success: true, meta: { changes: additions.length } }
        }
        if (sql.includes('/* hub:authorized-team-alias */')) {
          const [teamId, createdAt, ownerUserId] = params as [string, number, string]
          const [gateTeamId, actorUserId, requireTeamManager] = params.slice(-3) as [
            string,
            string,
            number,
          ]
          const oids = params.slice(3, -3) as string[]
          if (gateTeamId !== teamId) return { success: true, meta: { changes: 0 } }
          const role = activeTeamRoleFor(teamId, actorUserId)
          if (role === null || (requireTeamManager === 1 && role !== 'owner' && role !== 'admin')) {
            return { success: true, meta: { changes: 0 } }
          }
          const wanted = new Set(oids)
          const additions = state.hub_objects.filter(
            (object) =>
              object.owner_user_id === ownerUserId &&
              wanted.has(object.oid) &&
              !state.hub_team_objects.some(
                (candidate) => candidate.team_id === teamId && candidate.oid === object.oid,
              ),
          )
          const used = state.hub_team_objects
            .filter((row) => row.team_id === teamId)
            .reduce((total, row) => total + row.size, 0)
          const incoming = additions.reduce((total, row) => total + row.size, 0)
          if (used + incoming > 5 * 1024 * 1024 * 1024) {
            throw new Error('team storage quota exceeded')
          }
          for (const object of additions) {
            state.hub_team_objects.push({
              team_id: teamId,
              oid: object.oid,
              size: object.size,
              pack_key: object.pack_key,
              offset: object.offset,
              length: object.length,
              created_at: createdAt,
            })
          }
          return { success: true, meta: { changes: additions.length } }
        }
        if (/^UPDATE api_tokens SET last_used_at=\? WHERE token_hash=\?$/i.test(sql)) {
          const [lastUsedAt, tokenHash] = params as [number, string]
          const token = state.api_tokens.find((row) => row.token_hash === tokenHash)
          if (!token) return { success: true, meta: { changes: 0 } }
          token.last_used_at = lastUsedAt
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM api_tokens WHERE token_hash=\?$/i.test(sql)) {
          const [tokenHash] = params as [string]
          const before = state.api_tokens.length
          state.api_tokens = state.api_tokens.filter((row) => row.token_hash !== tokenHash)
          return { success: true, meta: { changes: before - state.api_tokens.length } }
        }
        if (/^DELETE FROM api_tokens WHERE user_id=\?$/i.test(sql)) {
          const [userId] = params as [string]
          const before = state.api_tokens.length
          state.api_tokens = state.api_tokens.filter((row) => row.user_id !== userId)
          return { success: true, meta: { changes: before - state.api_tokens.length } }
        }
        if (
          /^INSERT INTO api_tokens \(id, user_id, token_hash, label, created_at\) VALUES \(\?,\?,\?,\?,\?\)$/i.test(
            sql,
          )
        ) {
          const [id, userId, tokenHash, label, createdAt] = params as [
            string,
            string,
            string,
            string | null,
            number,
          ]
          state.api_tokens.push({
            id,
            user_id: userId,
            token_hash: tokenHash,
            label,
            created_at: createdAt,
            last_used_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }

        if (/^INSERT INTO users/i.test(sql)) {
          const [id, email, name, avatar, created, last] = params as [
            string,
            string,
            string | null,
            string | null,
            number,
            number,
          ]
          state.users.push({
            id,
            email,
            name,
            avatar_url: avatar,
            created_at: created,
            last_signin_at: last,
            deletion_pending_until: null,
            deleted_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE users SET email=\?, name=\?, avatar_url=\?, last_signin_at=\? WHERE id=\?/i.test(
            sql,
          )
        ) {
          const [email, name, avatar, last, id] = params as [
            string,
            string | null,
            string | null,
            number,
            string,
          ]
          const u = state.users.find((u) => u.id === id)
          if (u) {
            u.email = email
            u.name = name
            u.avatar_url = avatar
            u.last_signin_at = last
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^INSERT INTO user_identities \(provider, provider_sub, user_id, email, linked_at\) VALUES/i.test(
            sql,
          )
        ) {
          const [provider, provider_sub, user_id, email, linked_at] = params as [
            string,
            string,
            string,
            string | null,
            number,
          ]
          state.user_identities.push({ provider, provider_sub, user_id, email, linked_at })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM user_identities WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const before = state.user_identities.length
          state.user_identities = state.user_identities.filter((i) => i.user_id !== user_id)
          return { success: true, meta: { changes: before - state.user_identities.length } }
        }
        if (sql.includes('/* deletion:enqueue-workos-memberships */')) {
          const [nextAttemptAt, createdAt, updatedAt, userId] = params as [
            number,
            number,
            number,
            string,
          ]
          for (const membership of state.team_memberships) {
            if (membership.user_id !== userId || !membership.workos_membership_id) continue
            if (
              state.workos_cleanup_outbox.some(
                (row) =>
                  row.operation === 'membership.delete' &&
                  row.resource_id === membership.workos_membership_id,
              )
            ) {
              continue
            }
            state.workos_cleanup_outbox.push({
              id: `woc_test_${state.workos_cleanup_outbox.length}`,
              operation: 'membership.delete',
              resource_id: membership.workos_membership_id,
              team_id: membership.team_id,
              user_id: membership.user_id,
              attempts: 0,
              next_attempt_at: nextAttemptAt,
              last_error: null,
              created_at: createdAt,
              updated_at: updatedAt,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM team_memberships WHERE user_id=\?$/i.test(sql)) {
          const [userId] = params as [string]
          const before = state.team_memberships.length
          state.team_memberships = state.team_memberships.filter(
            (membership) => membership.user_id !== userId,
          )
          return { success: true, meta: { changes: before - state.team_memberships.length } }
        }
        if (sql.includes('/* workos-cleanup:enqueue */')) {
          const [id, operation, resourceId, teamId, userId, nextAttemptAt, createdAt, updatedAt] =
            params as [
              string,
              WorkosCleanupOutboxRow['operation'],
              string,
              string | null,
              string | null,
              number,
              number,
              number,
            ]
          const existing = state.workos_cleanup_outbox.find(
            (row) => row.operation === operation && row.resource_id === resourceId,
          )
          if (existing) {
            existing.next_attempt_at = Math.min(existing.next_attempt_at, nextAttemptAt)
            existing.updated_at = updatedAt
          } else {
            state.workos_cleanup_outbox.push({
              id,
              operation,
              resource_id: resourceId,
              team_id: teamId,
              user_id: userId,
              attempts: 0,
              next_attempt_at: nextAttemptAt,
              last_error: null,
              created_at: createdAt,
              updated_at: updatedAt,
            })
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (sql.includes('/* workos-cleanup:complete */')) {
          const [operation, resourceId] = params as [WorkosCleanupOutboxRow['operation'], string]
          const before = state.workos_cleanup_outbox.length
          state.workos_cleanup_outbox = state.workos_cleanup_outbox.filter(
            (row) => row.operation !== operation || row.resource_id !== resourceId,
          )
          return { success: true, meta: { changes: before - state.workos_cleanup_outbox.length } }
        }
        if (/^DELETE FROM workos_cleanup_outbox WHERE id=\?$/i.test(sql)) {
          const [id] = params as [string]
          const before = state.workos_cleanup_outbox.length
          state.workos_cleanup_outbox = state.workos_cleanup_outbox.filter((row) => row.id !== id)
          return { success: true, meta: { changes: before - state.workos_cleanup_outbox.length } }
        }
        if (sql.includes('/* workos-cleanup:retry */')) {
          const [attempts, nextAttemptAt, lastError, updatedAt, id] = params as [
            number,
            number,
            string,
            number,
            string,
          ]
          const row = state.workos_cleanup_outbox.find((candidate) => candidate.id === id)
          if (row) {
            row.attempts = attempts
            row.next_attempt_at = nextAttemptAt
            row.last_error = lastError
            row.updated_at = updatedAt
          }
          return { success: true, meta: { changes: row ? 1 : 0 } }
        }
        if (
          /^DELETE FROM workos_webhook_events WHERE processed_at IS NOT NULL AND received_at<\?$/i.test(
            sql,
          )
        ) {
          return { success: true, meta: { changes: 0 } }
        }
        if (/^INSERT INTO team_membership_blocks /i.test(sql)) {
          return { success: true, meta: { changes: 0 } }
        }
        if (
          /^UPDATE users SET deletion_pending_until=\? WHERE id=\? AND deleted_at IS NULL/i.test(
            sql,
          )
        ) {
          const [until, id] = params as [number, string]
          const u = state.users.find((u) => u.id === id && u.deleted_at === null)
          if (u) u.deletion_pending_until = until
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE users SET deletion_pending_until=NULL\s+WHERE id=\?/i.test(sql)) {
          const [id] = params as [string]
          const u = state.users.find((u) => u.id === id)
          if (u) u.deletion_pending_until = null
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT INTO audit_log/i.test(sql)) {
          const [user_id, ip_hash, ua_hash, action, target_id, details_json, ts] = params as [
            string | null,
            string,
            string,
            string,
            string | null,
            string | null,
            number,
          ]
          state.audit.push({ user_id, ip_hash, ua_hash, action, target_id, details_json, ts })
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /INSERT INTO handles\s+\(handle, user_id, team_id, claimed_at, released_at\)\s+SELECT \?,id,NULL,\?,NULL\s+FROM users/i.test(
            sql,
          )
        ) {
          const [handle, claimedAt, userId, actorUserId] = params as [
            string,
            number,
            string,
            string,
          ]
          const user = state.users.find(
            (candidate) =>
              candidate.id === userId &&
              candidate.id === actorUserId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          if (!user) return { success: true, meta: { changes: 0 } }
          if (
            state.handles.some(
              (candidate) =>
                candidate.handle === handle ||
                (candidate.user_id === userId && candidate.released_at === null),
            )
          ) {
            throw new Error('UNIQUE constraint failed: handles.handle')
          }
          state.handles.push({
            handle,
            user_id: userId,
            team_id: null,
            claimed_at: claimedAt,
            released_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /INSERT INTO handles\s+\(handle, user_id, team_id, claimed_at, released_at\)\s+SELECT \?,NULL,t\.id,\?,NULL\s+FROM teams t/i.test(
            sql,
          )
        ) {
          const [handle, claimedAt, teamId, actorUserId] = params as [
            string,
            number,
            string,
            string,
          ]
          const actor = state.users.find(
            (candidate) =>
              candidate.id === actorUserId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          const role = activeTeamRoleFor(teamId, actorUserId)
          if (!actor || role === null) {
            return { success: true, meta: { changes: 0 } }
          }
          if (
            state.handles.some(
              (candidate) =>
                candidate.handle === handle ||
                ((candidate.team_id ?? null) === teamId && candidate.released_at === null),
            )
          ) {
            throw new Error('UNIQUE constraint failed: handles.handle')
          }
          state.handles.push({
            handle,
            user_id: null,
            team_id: teamId,
            claimed_at: claimedAt,
            released_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^INSERT INTO handles \(handle, user_id, (?:team_id, )?claimed_at\) VALUES/i.test(sql)
        ) {
          const [handle, user_id, claimed_at] = params as [string, string, number]
          // Mirror the real D1 PK constraint so race-condition coverage works.
          if (state.handles.some((h) => h.handle === handle)) {
            throw new Error(`UNIQUE constraint failed: handles.handle`)
          }
          state.handles.push({
            handle,
            user_id,
            team_id: null,
            claimed_at,
            released_at: null,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (/^INSERT OR REPLACE INTO deletion_queue/i.test(sql)) {
          const [user_id, scheduled_at] = params as [string, number]
          const idx = state.deletion_queue.findIndex((r) => r.user_id === user_id)
          const row = { user_id, scheduled_at, cancelled: 0 }
          if (idx >= 0) state.deletion_queue[idx] = row
          else state.deletion_queue.push(row)
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE deletion_queue SET cancelled=1 WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const r = state.deletion_queue.find((x) => x.user_id === user_id)
          if (r) r.cancelled = 1
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^INSERT INTO published_shares \(id, user_id, title, visibility, version, published_at, draft_id, client_request_id\)/i.test(
            sql,
          )
        ) {
          const [
            id,
            user_id,
            title,
            visibility,
            version,
            published_at,
            draft_id,
            client_request_id,
          ] = params as [
            string,
            string,
            string,
            string,
            number,
            number,
            string | null,
            string | null,
          ]
          // Mirror the UNIQUE(user_id, client_request_id) partial index
          // so the publish handler's catch-and-resolve path is exercised
          // by tests, not just live D1. The predicate matches the live
          // schema: NULL tokens AND revoked rows are not constrained,
          // so a publish-after-revoke with the same content can recycle
          // the token onto a fresh row.
          if (
            client_request_id !== null &&
            state.published_shares.some(
              (s) =>
                s.user_id === user_id &&
                s.client_request_id === client_request_id &&
                s.revoked_at === null,
            )
          ) {
            throw new Error(
              'UNIQUE constraint failed: published_shares.user_id, published_shares.client_request_id',
            )
          }
          state.published_shares.push({
            id,
            user_id,
            title,
            visibility,
            expires_at: null,
            version,
            published_at,
            republished_at: null,
            revoked_at: null,
            draft_id,
            client_request_id,
          })
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE published_shares SET title=\?, visibility=\?, version=\?, republished_at=\?, draft_id=\?, client_request_id=\? WHERE id=\? AND user_id=\? AND version=\?/i.test(
            sql,
          )
        ) {
          const [
            title,
            visibility,
            version,
            republished_at,
            draft_id,
            client_request_id,
            id,
            user_id,
            expectedVersion,
          ] = params as [
            string,
            string,
            number,
            number,
            string | null,
            string | null,
            string,
            string,
            number,
          ]
          // Honour the optimistic-concurrency clause: only the row whose
          // current version still matches the SELECTed-then-bound value
          // gets touched. A racing republish bumps the version out from
          // under us → 0 rows changed → caller surfaces 409.
          const s = state.published_shares.find(
            (x) => x.id === id && x.user_id === user_id && x.version === expectedVersion,
          )
          if (!s) return { success: true, meta: { changes: 0 } }
          // Mirror the partial UNIQUE(user_id, client_request_id) index
          // on the republish path too. If another LIVE row for the same
          // user already holds this token (rare: two drafts whose
          // snapshot+visibility hash to the same content), the
          // index fires. Without this branch, tests would silently
          // accept a state real D1 rejects, hiding bugs in the handler.
          if (
            client_request_id !== null &&
            state.published_shares.some(
              (x) =>
                x.user_id === user_id &&
                x.client_request_id === client_request_id &&
                x.revoked_at === null &&
                x.id !== id,
            )
          ) {
            throw new Error(
              'UNIQUE constraint failed: published_shares.user_id, published_shares.client_request_id',
            )
          }
          s.title = title
          s.visibility = visibility
          s.version = version
          s.republished_at = republished_at
          s.draft_id = draft_id
          s.client_request_id = client_request_id
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET revoked_at=\? WHERE id=\?/i.test(sql)) {
          const [revoked_at, id] = params as [number, string]
          const s = state.published_shares.find((x) => x.id === id)
          if (s) s.revoked_at = revoked_at
          return { success: true, meta: { changes: 1 } }
        }
        if (/^UPDATE published_shares SET visibility=\? WHERE id=\? AND user_id=\?/i.test(sql)) {
          const [visibility, id, user_id] = params as [string, string, string]
          const s = state.published_shares.find((x) => x.id === id && x.user_id === user_id)
          if (s) s.visibility = visibility
          return { success: true, meta: { changes: s ? 1 : 0 } }
        }
        if (/^UPDATE published_shares SET visibility=\? WHERE id=\?/i.test(sql)) {
          const [visibility, id] = params as [string, string]
          const s = state.published_shares.find((x) => x.id === id)
          if (s) s.visibility = visibility
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE published_shares SET revoked_at=\? WHERE user_id=\? AND revoked_at IS NULL/i.test(
            sql,
          )
        ) {
          const [revoked_at, user_id] = params as [number, string]
          for (const s of state.published_shares) {
            if (s.user_id === user_id && s.revoked_at === null) s.revoked_at = revoked_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE handles SET released_at=\? WHERE user_id=\? AND released_at IS NULL/i.test(sql)
        ) {
          const [released_at, user_id] = params as [number, string]
          for (const h of state.handles) {
            if (h.user_id === user_id && h.released_at === null) h.released_at = released_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (
          /^UPDATE users SET email='\[deleted\]', name=NULL, avatar_url=NULL, display_name=NULL, custom_avatar_id=NULL, deleted_at=\? WHERE id=\?/i.test(
            sql,
          )
        ) {
          const [deleted_at, id] = params as [number, string]
          const u = state.users.find((u) => u.id === id)
          if (u) {
            u.email = '[deleted]'
            u.name = null
            u.avatar_url = null
            u.deleted_at = deleted_at
          }
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM deletion_queue WHERE user_id=\?/i.test(sql)) {
          const [user_id] = params as [string]
          const idx = state.deletion_queue.findIndex((r) => r.user_id === user_id)
          if (idx >= 0) state.deletion_queue.splice(idx, 1)
          return { success: true, meta: { changes: 1 } }
        }
        if (/^DELETE FROM hub_objects WHERE owner_user_id=\?$/i.test(sql)) {
          const [ownerUserId] = params as [string]
          const before = state.hub_objects.length
          state.hub_objects = state.hub_objects.filter((row) => row.owner_user_id !== ownerUserId)
          return { success: true, meta: { changes: before - state.hub_objects.length } }
        }
        if (sql.includes('/* account-deletion:delete-target-stars */')) {
          const [ownerUserId] = params as [string]
          const targetSids = new Set(
            state.hub_sessions
              .filter((row) => row.owner_user_id === ownerUserId && row.team_id == null)
              .map((row) => row.sid),
          )
          const before = state.hub_session_stars.length
          state.hub_session_stars = state.hub_session_stars.filter(
            (row) => !targetSids.has(row.sid),
          )
          return { success: true, meta: { changes: before - state.hub_session_stars.length } }
        }
        if (sql.includes('/* account-deletion:delete-viewer-stars */')) {
          const [userId] = params as [string]
          const before = state.hub_session_stars.length
          state.hub_session_stars = state.hub_session_stars.filter((row) => row.user_id !== userId)
          return { success: true, meta: { changes: before - state.hub_session_stars.length } }
        }
        if (/^DELETE FROM hub_sessions WHERE owner_user_id=\? AND team_id IS NULL$/i.test(sql)) {
          const [ownerUserId] = params as [string]
          const deletedSids = new Set(
            state.hub_sessions
              .filter((row) => row.owner_user_id === ownerUserId && row.team_id == null)
              .map((row) => row.sid),
          )
          const before = state.hub_sessions.length
          state.hub_sessions = state.hub_sessions.filter(
            (row) => row.owner_user_id !== ownerUserId || row.team_id != null,
          )
          state.hub_session_discovery = state.hub_session_discovery.filter(
            (row) => !deletedSids.has(row.sid),
          )
          state.hub_session_engagement_daily = state.hub_session_engagement_daily.filter(
            (row) => !deletedSids.has(row.sid),
          )
          state.hub_session_stars = state.hub_session_stars.filter(
            (row) => !deletedSids.has(row.sid),
          )
          return { success: true, meta: { changes: before - state.hub_sessions.length } }
        }
        if (sql.includes('/* account-deletion:delete-personal-project-receipts */')) {
          const [ownerUserId] = params as [string]
          const before = state.project_creation_requests.length
          state.project_creation_requests = state.project_creation_requests.filter(
            (row) => row.owner_user_id !== ownerUserId || row.owner_team_id !== null,
          )
          return {
            success: true,
            meta: { changes: before - state.project_creation_requests.length },
          }
        }
        if (sql.includes('/* account-deletion:delete-personal-projects */')) {
          const [ownerUserId] = params as [string]
          const before = state.projects.length
          state.projects = state.projects.filter(
            (row) => row.owner_user_id !== ownerUserId || row.owner_team_id !== null,
          )
          return { success: true, meta: { changes: before - state.projects.length } }
        }
        if (/^DELETE FROM hub_session_engagement_daily WHERE sid=\?$/i.test(sql)) {
          const [sid] = params as [string]
          const before = state.hub_session_engagement_daily.length
          state.hub_session_engagement_daily = state.hub_session_engagement_daily.filter(
            (row) => row.sid !== sid,
          )
          return {
            success: true,
            meta: { changes: before - state.hub_session_engagement_daily.length },
          }
        }
        if (/^DELETE FROM hub_session_discovery WHERE sid=\?$/i.test(sql)) {
          const [sid] = params as [string]
          const before = state.hub_session_discovery.length
          state.hub_session_discovery = state.hub_session_discovery.filter((row) => row.sid !== sid)
          return {
            success: true,
            meta: { changes: before - state.hub_session_discovery.length },
          }
        }
        throw new Error(`unmocked run() SQL: ${sql}`)
      },
      async all<T = unknown>(): Promise<{ results: T[] }> {
        if (sql.includes('/* teams:list */')) {
          const [userId, limit] = params as [string, number]
          const items = state.team_memberships
            .filter((membership) => membership.user_id === userId)
            .flatMap((membership) => {
              const team = state.teams.find(
                (candidate) =>
                  candidate.id === membership.team_id &&
                  candidate.archived_at === null &&
                  (candidate.deletion_pending_until ?? null) === null,
              )
              if (!team) return []
              return [
                {
                  ...team,
                  role: membership.role,
                  handle:
                    state.handles.find(
                      (candidate) =>
                        (candidate.team_id ?? null) === team.id && candidate.released_at === null,
                    )?.handle ?? null,
                  member_count: state.team_memberships.filter(
                    (candidate) => candidate.team_id === team.id,
                  ).length,
                  owner_count: state.team_memberships.filter(
                    (candidate) => candidate.team_id === team.id && candidate.role === 'owner',
                  ).length,
                },
              ]
            })
            .slice(0, limit)
          return { results: items as T[] }
        }
        if (sql.includes('/* projects:list-hub-authorized */')) {
          const [userId, hasAfter, beforeUpdatedAt, equalUpdatedAt, afterId, limit] = params as [
            string,
            number,
            number,
            number,
            string,
            number,
          ]
          const actor = state.users.find(
            (user) =>
              user.id === userId &&
              user.deleted_at === null &&
              user.deletion_pending_until === null,
          )
          if (!actor) return { results: [] }
          const rows = state.projects
            .flatMap((project) => {
              const role =
                project.owner_team_id === null
                  ? null
                  : activeTeamRoleFor(project.owner_team_id, userId)
              if (
                project.archived_at !== null ||
                (project.owner_user_id !== userId && role === null)
              ) {
                return []
              }
              const handle = state.handles.find(
                (candidate) =>
                  candidate.released_at === null &&
                  candidate.user_id === project.owner_user_id &&
                  (candidate.team_id ?? null) === project.owner_team_id,
              )
              if (!handle) return []
              const ownerUser =
                project.owner_user_id === null
                  ? null
                  : (state.users.find((user) => user.id === project.owner_user_id) ?? null)
              const ownerTeam =
                project.owner_team_id === null
                  ? null
                  : (state.teams.find((team) => team.id === project.owner_team_id) ?? null)
              return [
                {
                  ...project,
                  session_count: state.hub_sessions.filter(
                    (session) => session.project_id === project.id && session.withdrawn_at === null,
                  ).length,
                  star_count: 0,
                  owner_handle: handle.handle,
                  owner_name:
                    ownerTeam?.name ??
                    ownerUser?.display_name ??
                    ownerUser?.name ??
                    ownerUser?.email.split('@')[0] ??
                    handle.handle,
                  owner_avatar_url: ownerUser?.avatar_url ?? null,
                  owner_custom_avatar_id: ownerUser?.custom_avatar_id ?? null,
                  owner_avatar_visible: ownerUser?.avatar_visible ?? 1,
                  can_manage:
                    project.owner_user_id === userId || role === 'owner' || role === 'admin'
                      ? 1
                      : 0,
                },
              ]
            })
            .sort(
              (left, right) =>
                right.updated_at - left.updated_at || left.id.localeCompare(right.id),
            )
            .filter(
              (project) =>
                hasAfter === 0 ||
                project.updated_at < beforeUpdatedAt ||
                (project.updated_at === equalUpdatedAt && project.id > afterId),
            )
            .slice(0, limit)
          return { results: rows as T[] }
        }
        if (
          sql.includes('FROM projects p') &&
          sql.includes('JOIN users owner ON owner.id=p.owner_user_id') &&
          sql.includes('WHERE p.owner_user_id=? AND p.owner_team_id IS NULL') &&
          !sql.includes('JOIN hub_sessions')
        ) {
          const [userId, hasAfter, beforeUpdatedAt, equalUpdatedAt, afterId, limit] = params as [
            string,
            number,
            number,
            number,
            string,
            number,
          ]
          const user = state.users.find(
            (candidate) =>
              candidate.id === userId &&
              candidate.deleted_at === null &&
              candidate.deletion_pending_until === null,
          )
          const items = user
            ? state.projects
                .filter(
                  (project) =>
                    project.owner_user_id === userId &&
                    project.owner_team_id === null &&
                    project.archived_at === null,
                )
                .map((project) => ({
                  ...project,
                  session_count: state.hub_sessions.filter(
                    (session) => session.project_id === project.id && session.withdrawn_at === null,
                  ).length,
                  star_count: 0,
                }))
                .sort(
                  (left, right) =>
                    right.updated_at - left.updated_at || left.id.localeCompare(right.id),
                )
                .filter(
                  (project) =>
                    hasAfter === 0 ||
                    project.updated_at < beforeUpdatedAt ||
                    (project.updated_at === equalUpdatedAt && project.id > afterId),
                )
                .slice(0, limit)
            : []
          return { results: items as T[] }
        }
        if (sql.includes('/* projects:list-team-authorized */')) {
          const [teamId, userId, hasAfter, beforeUpdatedAt, equalUpdatedAt, afterId, limit] =
            params as [string, string, number, number, number, string, number]
          const role = activeTeamRoleFor(teamId, userId)
          if (role === null) return { results: [] }
          const projects = state.projects
            .filter(
              (project) =>
                project.owner_user_id === null &&
                project.owner_team_id === teamId &&
                project.archived_at === null,
            )
            .map((project) => ({
              ...project,
              session_count: state.hub_sessions.filter(
                (session) => session.project_id === project.id && session.withdrawn_at === null,
              ).length,
              star_count: 0,
            }))
            .sort(
              (left, right) =>
                right.updated_at - left.updated_at || left.id.localeCompare(right.id),
            )
            .filter(
              (project) =>
                hasAfter === 0 ||
                project.updated_at < beforeUpdatedAt ||
                (project.updated_at === equalUpdatedAt && project.id > afterId),
            )
            .slice(0, limit)
          return {
            results: (projects.length > 0 ? projects : [{ id: null }]) as T[],
          }
        }
        if (sql.includes('/* projects:list-public */')) {
          const [hasAfter, beforePublishedAt, equalPublishedAt, afterId, limit] = params as [
            number,
            number,
            number,
            string,
            number,
          ]
          const items = state.projects
            .flatMap((project) => {
              if (project.archived_at !== null) return []
              const user =
                project.owner_user_id === null
                  ? null
                  : state.users.find(
                      (candidate) =>
                        candidate.id === project.owner_user_id &&
                        candidate.deleted_at === null &&
                        candidate.deletion_pending_until === null,
                    )
              const team =
                project.owner_team_id === null
                  ? null
                  : state.teams.find(
                      (candidate) =>
                        candidate.id === project.owner_team_id &&
                        candidate.archived_at === null &&
                        (candidate.deletion_pending_until ?? null) === null,
                    )
              const handle = state.handles.find(
                (candidate) =>
                  candidate.user_id === project.owner_user_id &&
                  (candidate.team_id ?? null) === project.owner_team_id &&
                  candidate.released_at === null,
              )
              if ((!user && !team) || !handle) return []
              const published = state.hub_sessions.flatMap((session) => {
                const projection = state.hub_session_discovery.find(
                  (candidate) => candidate.sid === session.sid,
                )
                return session.project_id === project.id &&
                  ((project.owner_user_id !== null &&
                    session.owner_user_id === project.owner_user_id &&
                    (session.team_id ?? null) === null) ||
                    (project.owner_team_id !== null &&
                      session.team_id === project.owner_team_id)) &&
                  session.visibility === 'unlisted' &&
                  session.withdrawn_at === null &&
                  projection
                  ? [projection]
                  : []
              })
              if (published.length === 0) return []
              return [
                {
                  ...project,
                  session_count: published.length,
                  last_session_at: Math.max(...published.map((row) => row.published_at)),
                  star_count: 0,
                  owner_handle: handle.handle,
                  owner_email: user?.email ?? null,
                  owner_name: team?.name ?? user?.name ?? null,
                  owner_display_name: user?.display_name ?? null,
                  owner_avatar_url: user?.avatar_url ?? null,
                  owner_custom_avatar_id: user?.custom_avatar_id ?? null,
                  owner_avatar_visible: user?.avatar_visible ?? 1,
                },
              ]
            })
            .filter(
              (project) =>
                hasAfter === 0 ||
                project.last_session_at < beforePublishedAt ||
                (project.last_session_at === equalPublishedAt && project.id > afterId),
            )
            .sort(
              (left, right) =>
                right.last_session_at - left.last_session_at || left.id.localeCompare(right.id),
            )
            .slice(0, limit)
          return { results: items as T[] }
        }
        if (
          sql.includes('SELECT p.*, COUNT(d.sid) AS session_count') &&
          sql.includes('JOIN hub_session_discovery d')
        ) {
          const [ownerUserId, ownerTeamId, personal, team, limit] = params as [
            string | null,
            string | null,
            number,
            number,
            number,
          ]
          const projects = state.projects.flatMap((project) => {
            if (
              project.owner_user_id !== ownerUserId ||
              project.owner_team_id !== ownerTeamId ||
              project.archived_at !== null
            ) {
              return []
            }
            const projections = state.hub_sessions.flatMap((session) => {
              const projection = state.hub_session_discovery.find(
                (candidate) => candidate.sid === session.sid,
              )
              return session.project_id === project.id &&
                ((personal === 1 &&
                  session.owner_user_id === ownerUserId &&
                  (session.team_id ?? null) === null) ||
                  (team === 1 && session.team_id === ownerTeamId)) &&
                session.visibility === 'unlisted' &&
                session.withdrawn_at === null &&
                projection
                ? [projection]
                : []
            })
            return projections.length === 0
              ? []
              : [
                  {
                    ...project,
                    session_count: projections.length,
                    star_count: 0,
                    last_session_at: Math.max(...projections.map((row) => row.published_at)),
                  },
                ]
          })
          projects.sort(
            (left, right) =>
              right.last_session_at - left.last_session_at || left.id.localeCompare(right.id),
          )
          return { results: projects.slice(0, limit) as T[] }
        }
        if (
          sql.includes('/* projects:list-sessions-authorized */') ||
          sql.includes('/* projects:list-public-sessions */') ||
          sql.includes('/* projects:list-public-owner-sessions */')
        ) {
          const publicProject = sql.includes('/* projects:list-public-sessions */')
          const publicOwner = sql.includes('/* projects:list-public-owner-sessions */')
          const projectId = publicOwner ? null : (params[0] as string)
          const ownerUserId = publicOwner
            ? (params[0] as string | null)
            : publicProject
              ? (params[1] as string | null)
              : null
          const ownerTeamId = publicOwner
            ? (params[1] as string | null)
            : publicProject
              ? (params[2] as string | null)
              : null
          const personal = publicOwner ? Number(params[2]) : publicProject ? Number(params[3]) : 0
          const team = publicOwner ? Number(params[3]) : publicProject ? Number(params[4]) : 0
          const teamId = !publicProject && !publicOwner ? (params[2] as string | null) : null
          const actorUserId = !publicProject && !publicOwner ? (params[4] as string) : null
          const cursorOffset = publicOwner ? 4 : publicProject ? 5 : 8
          const hasAfter = Number(params[cursorOffset] ?? 0)
          const afterSortAt = Number(params[cursorOffset + 1] ?? 0)
          const equalSortAt = Number(params[cursorOffset + 2] ?? 0)
          const afterSid = String(params[cursorOffset + 3] ?? '')
          const limit = Number(params[cursorOffset + 4] ?? Number.MAX_SAFE_INTEGER)
          const rows = state.hub_sessions
            .filter((session) => {
              if (projectId !== null && session.project_id !== projectId) return false
              if (session.withdrawn_at !== null) return false
              if (publicProject || publicOwner) {
                return (
                  ((personal === 1 &&
                    ownerUserId !== null &&
                    session.owner_user_id === ownerUserId &&
                    (session.team_id ?? null) === null) ||
                    (team === 1 && ownerTeamId !== null && session.team_id === ownerTeamId)) &&
                  session.visibility === 'unlisted' &&
                  state.hub_session_discovery.some((projection) => projection.sid === session.sid)
                )
              }
              if (teamId === null) {
                return (session.team_id ?? null) === null && session.owner_user_id === actorUserId
              }
              return (
                session.team_id === teamId &&
                actorUserId !== null &&
                activeTeamRoleFor(teamId, actorUserId) !== null
              )
            })
            .map((session) => {
              const publishedAt =
                state.hub_session_discovery.find((projection) => projection.sid === session.sid)
                  ?.published_at ?? 0
              return {
                ...session,
                ...hydratedManagedSessionFields(session),
                team_name:
                  session.team_id == null
                    ? null
                    : (state.teams.find((team) => team.id === session.team_id)?.name ?? null),
                star_count: state.hub_session_stars.filter((star) => star.sid === session.sid)
                  .length,
                published_at: publishedAt,
                project_sort_at: publicProject || publicOwner ? publishedAt : session.updated_at,
              }
            })
            .filter(
              (session) =>
                hasAfter === 0 ||
                session.project_sort_at < afterSortAt ||
                (session.project_sort_at === equalSortAt && session.sid > afterSid),
            )
            .sort((left, right) =>
              publicProject || publicOwner
                ? right.published_at - left.published_at || left.sid.localeCompare(right.sid)
                : right.updated_at - left.updated_at || left.sid.localeCompare(right.sid),
            )
            .slice(0, limit)
          return { results: rows as T[] }
        }
        if (sql.includes('/* teams:local-workos-memberships */')) {
          const [userId, after, limit] = params as [string, string, number]
          const items = state.team_memberships
            .filter(
              (membership) =>
                membership.user_id === userId && membership.workos_membership_id !== null,
            )
            .filter((membership) => (membership.workos_membership_id ?? '') > after)
            .sort((left, right) =>
              (left.workos_membership_id ?? '').localeCompare(right.workos_membership_id ?? ''),
            )
            .flatMap((membership) => {
              const team = state.teams.find(
                (candidate) =>
                  candidate.id === membership.team_id && candidate.archived_at === null,
              )
              return team
                ? [
                    {
                      workos_membership_id: membership.workos_membership_id,
                      workos_organization_id: team.workos_organization_id,
                    },
                  ]
                : []
            })
            .slice(0, limit)
          return { results: items as T[] }
        }
        if (sql.includes('/* workos-cleanup:due */')) {
          const [now, limit] = params as [number, number]
          const items = state.workos_cleanup_outbox
            .filter((row) => row.next_attempt_at <= now)
            .sort((left, right) =>
              left.next_attempt_at === right.next_attempt_at
                ? left.created_at - right.created_at
                : left.next_attempt_at - right.next_attempt_at,
            )
            .slice(0, limit)
          return { results: items as T[] }
        }
        if (sql.includes('/* discovery:list-page ')) {
          const marker = sql.match(
            /\/\* discovery:list-page sort=(recommended|trending|recent) query=([01]) tokens=(\d+) agent=(all|claude|codex) \*\//,
          )
          if (!marker) throw new Error(`Malformed discovery fake marker: ${sql}`)
          const sort = marker[1] as 'recommended' | 'trending' | 'recent'
          const hasQuery = marker[2] === '1'
          const tokenCount = Number(marker[3])
          const markerAgent = marker[4]
          let parameterIndex = 0
          const ranked = sort !== 'recent'
          const engagementFromDay = ranked ? (params[parameterIndex++] as string) : null
          const engagementToDayExclusive = ranked ? (params[parameterIndex++] as string) : null
          const agent = markerAgent === 'all' ? null : (params[parameterIndex++] as SessionProvider)
          const tokens: string[] = []
          for (let index = 0; index < tokenCount; index += 1) {
            tokens.push(params[parameterIndex] as string)
            parameterIndex += 3
          }
          const rankedAt = params[parameterIndex++] as number
          const projectionRankedAt = params[parameterIndex++] as number
          if (projectionRankedAt !== rankedAt) {
            throw new Error('Discovery fake received mismatched projection timestamps')
          }
          const ranksByRelevance = hasQuery && sort !== 'recent'
          const query = ranksByRelevance ? (params[parameterIndex] as string) : null
          if (ranksByRelevance) {
            parameterIndex += 8 + tokenCount * 6
          }
          if (ranked) {
            const scoreRankedAt = params[parameterIndex++] as number
            if (scoreRankedAt !== rankedAt) {
              throw new Error('Discovery fake received mismatched ranking timestamps')
            }
          }
          const hasAfter = params[parameterIndex++] === 1
          const afterRelevance = params[parameterIndex++] as number
          const afterSortScore = params[parameterIndex++] as number
          const afterPublishedAt = params[parameterIndex++] as number
          const afterSid = params[parameterIndex++] as string
          const limit = params[parameterIndex] as number

          const items = state.hub_session_discovery
            .flatMap((discovery) => {
              if (agent !== null && discovery.agent !== agent) return []
              const session = state.hub_sessions.find(
                (row) =>
                  row.sid === discovery.sid &&
                  row.visibility === 'unlisted' &&
                  row.withdrawn_at === null,
              )
              if (!session) return []
              const user = state.users.find((row) => row.id === session.owner_user_id)
              if (!user) return []
              const owningTeam = session.team_id
                ? state.teams.find(
                    (row) =>
                      row.id === session.team_id &&
                      row.archived_at === null &&
                      row.deletion_pending_until === null,
                  )
                : null
              if (
                (session.team_id == null && user.deleted_at !== null) ||
                (session.team_id != null && !owningTeam) ||
                discovery.published_at > rankedAt ||
                discovery.updated_at > rankedAt
              ) {
                return []
              }
              const identityLive = user.deleted_at === null
              const handle =
                (identityLive
                  ? state.handles
                      .filter(
                        (row) => row.user_id === session.owner_user_id && row.released_at === null,
                      )
                      .map((row) => row.handle)
                      .sort()[0]
                  : null) ?? null
              const displayName = identityLive ? (user.display_name ?? user.name ?? '') : ''
              if (
                !tokens.every(
                  (token) =>
                    discovery.search_text.includes(token) ||
                    (handle ?? '').toLowerCase().includes(token) ||
                    displayName.toLowerCase().includes(token),
                )
              ) {
                return []
              }
              const qualifiedReads =
                ranked && engagementFromDay !== null && engagementToDayExclusive !== null
                  ? state.hub_session_engagement_daily
                      .filter(
                        (row) =>
                          row.sid === discovery.sid &&
                          row.day >= engagementFromDay &&
                          row.day < engagementToDayExclusive,
                      )
                      .reduce((sum, row) => sum + row.qualified_reads, 0)
                  : 0
              const normalizedAuthor = identityLive
                ? `${handle ?? ''} ${displayName}`.trim().toLowerCase()
                : ''
              const relevanceScore =
                query === null
                  ? 0
                  : fakeDiscoveryRelevance(discovery, normalizedAuthor, query, tokens)
              const sortScore =
                sort === 'recent'
                  ? null
                  : fakeDiscoverySortScore(discovery, sort, qualifiedReads, rankedAt)
              const lineageSourceSid = (() => {
                if (!discovery.lineage_source_sid) return null
                const sourceProjection = state.hub_session_discovery.find(
                  (row) => row.sid === discovery.lineage_source_sid,
                )
                const sourceSession = state.hub_sessions.find(
                  (row) =>
                    row.sid === discovery.lineage_source_sid &&
                    row.visibility === 'unlisted' &&
                    row.withdrawn_at === null,
                )
                if (!sourceProjection || !sourceSession) return null
                const sourceUser = state.users.find((row) => row.id === sourceSession.owner_user_id)
                if (!sourceUser) return null
                if (sourceSession.team_id == null) {
                  return sourceUser.deleted_at === null ? discovery.lineage_source_sid : null
                }
                const sourceTeam = state.teams.find(
                  (row) =>
                    row.id === sourceSession.team_id &&
                    row.archived_at === null &&
                    row.deletion_pending_until === null,
                )
                return sourceTeam ? discovery.lineage_source_sid : null
              })()
              const publicProject = session.project_id
                ? state.projects.find(
                    (project) =>
                      project.id === session.project_id &&
                      ((session.team_id == null &&
                        project.owner_user_id === session.owner_user_id &&
                        project.owner_team_id === null) ||
                        (session.team_id != null &&
                          project.owner_user_id === null &&
                          project.owner_team_id === session.team_id)),
                  )
                : null
              const projectOwnerHandle =
                publicProject == null
                  ? null
                  : (state.handles.find(
                      (candidate) =>
                        candidate.released_at === null &&
                        candidate.user_id === publicProject.owner_user_id &&
                        (candidate.team_id ?? null) === publicProject.owner_team_id,
                    )?.handle ?? null)
              return [
                {
                  ...discovery,
                  lineage_source_sid: lineageSourceSid,
                  record_count: session.record_count,
                  owner_user_id: session.owner_user_id,
                  project_id: publicProject?.id ?? null,
                  project_slug: publicProject?.slug ?? null,
                  project_name: publicProject?.name ?? null,
                  project_owner_kind:
                    publicProject == null
                      ? null
                      : publicProject.owner_team_id === null
                        ? 'user'
                        : 'team',
                  project_owner_handle: projectOwnerHandle,
                  handle,
                  name: identityLive ? user.name : null,
                  display_name: identityLive ? (user.display_name ?? null) : null,
                  avatar_url: identityLive ? user.avatar_url : null,
                  custom_avatar_id: identityLive ? (user.custom_avatar_id ?? null) : null,
                  avatar_visible: identityLive ? (user.avatar_visible ?? 1) : 0,
                  qualified_reads_7d: qualifiedReads,
                  star_count: state.hub_session_stars.filter((row) => row.sid === discovery.sid)
                    .length,
                  relevance_score: relevanceScore,
                  sort_score: sortScore,
                },
              ]
            })
            .filter((item) => {
              if (!hasAfter) return true
              if (item.relevance_score !== afterRelevance) {
                return item.relevance_score < afterRelevance
              }
              if (
                sort !== 'recent' &&
                item.sort_score !== null &&
                item.sort_score !== afterSortScore
              ) {
                return item.sort_score < afterSortScore
              }
              if (item.published_at !== afterPublishedAt) {
                return item.published_at < afterPublishedAt
              }
              return item.sid > afterSid
            })
            .sort((left, right) => {
              if (left.relevance_score !== right.relevance_score) {
                return right.relevance_score - left.relevance_score
              }
              if (
                sort !== 'recent' &&
                left.sort_score !== null &&
                right.sort_score !== null &&
                left.sort_score !== right.sort_score
              ) {
                return right.sort_score - left.sort_score
              }
              if (left.published_at !== right.published_at) {
                return right.published_at - left.published_at
              }
              return left.sid < right.sid ? -1 : left.sid > right.sid ? 1 : 0
            })
            .slice(0, limit)
          return { results: items as T[] }
        }
        if (/^SELECT DISTINCT pack_key FROM hub_objects WHERE owner_user_id=\?$/i.test(sql)) {
          const [ownerUserId] = params as [string]
          const packKeys = new Set(
            state.hub_objects
              .filter((row) => row.owner_user_id === ownerUserId)
              .map((row) => row.pack_key),
          )
          return { results: [...packKeys].map((pack_key) => ({ pack_key })) as T[] }
        }
        if (/^SELECT DISTINCT pack_key FROM hub_team_objects WHERE pack_key LIKE \?$/i.test(sql)) {
          return { results: [] }
        }
        if (
          /^SELECT oid FROM hub_objects WHERE owner_user_id=\? AND oid IN \(\?(?:,\?)*\)$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, ...oids] = params as [string, ...string[]]
          const wanted = new Set(oids)
          const items = state.hub_objects
            .filter((row) => row.owner_user_id === ownerUserId && wanted.has(row.oid))
            .map((row) => ({ oid: row.oid }))
          return { results: items as T[] }
        }
        if (
          /^SELECT oid FROM hub_team_objects WHERE team_id=\? AND oid IN \(\?(?:,\?)*\)$/i.test(sql)
        ) {
          const [teamId, ...oids] = params as [string, ...string[]]
          const wanted = new Set(oids)
          const items = state.hub_team_objects
            .filter((row) => row.team_id === teamId && wanted.has(row.oid))
            .map((row) => ({ oid: row.oid }))
          return { results: items as T[] }
        }
        if (
          /^SELECT oid, pack_key, offset, length FROM hub_objects WHERE owner_user_id=\? AND oid IN \(\?(?:,\?)*\)$/i.test(
            sql,
          )
        ) {
          const [ownerUserId, ...oids] = params as [string, ...string[]]
          const wanted = new Set(oids)
          const items = state.hub_objects
            .filter((row) => row.owner_user_id === ownerUserId && wanted.has(row.oid))
            .map((row) => ({
              oid: row.oid,
              pack_key: row.pack_key,
              offset: row.offset,
              length: row.length,
            }))
          return { results: items as T[] }
        }
        if (
          /^SELECT oid, pack_key, offset, length FROM hub_team_objects WHERE team_id=\? AND oid IN \(\?(?:,\?)*\)$/i.test(
            sql,
          )
        ) {
          const [teamId, ...oids] = params as [string, ...string[]]
          const wanted = new Set(oids)
          const items = state.hub_team_objects
            .filter((row) => row.team_id === teamId && wanted.has(row.oid))
            .map(({ oid, pack_key, offset, length }) => ({ oid, pack_key, offset, length }))
          return { results: items as T[] }
        }
        if (
          /^SELECT user_id FROM deletion_queue/i.test(sql) &&
          sql.includes("state='pending'") &&
          sql.includes("state='processing'")
        ) {
          const [cutoff, leaseCutoff] = params as [number, number]
          const items = state.deletion_queue
            .filter(
              (r) =>
                r.scheduled_at <= cutoff &&
                r.cancelled === 0 &&
                (deletionState(r) === 'pending' ||
                  (deletionState(r) === 'processing' &&
                    (r.processing_lease_until ?? 0) <= leaseCutoff)),
            )
            .map((r) => ({ user_id: r.user_id }))
          return { results: items as T[] }
        }
        if (/^SELECT id FROM published_shares WHERE user_id=\?/i.test(sql)) {
          const [uid] = params as [string]
          const items = state.published_shares
            .filter((s) => s.user_id === uid)
            .map((s) => ({ id: s.id }))
          return { results: items as T[] }
        }
        if (
          /^SELECT id FROM published_shares\s+WHERE revoked_at IS NOT NULL AND revoked_at > \?\s+LIMIT \?/i.test(
            sql,
          )
        ) {
          const [revokedCutoff, limit] = params as [number, number]
          const items = state.published_shares
            .filter((s) => s.revoked_at !== null && s.revoked_at > revokedCutoff)
            .slice(0, limit)
            .map((s) => ({ id: s.id }))
          return { results: items as T[] }
        }
        if (
          /^SELECT id, title, published_at, version FROM published_shares WHERE user_id = \? AND visibility = \? AND revoked_at IS NULL ORDER BY published_at DESC LIMIT \?/i.test(
            sql,
          )
        ) {
          const [uid, vis, limit] = params as [string, string, number]
          const items = state.published_shares
            .filter((s) => s.user_id === uid && s.visibility === vis && s.revoked_at === null)
            .slice()
            .sort((a, b) => b.published_at - a.published_at)
            .slice(0, limit)
            .map((s) => ({
              id: s.id,
              title: s.title,
              published_at: s.published_at,
              version: s.version,
            }))
          return { results: items as T[] }
        }
        if (
          /^SELECT user_id, ip_hash, ua_hash, action, target_id, details_json, ts FROM audit_log ORDER BY ts DESC LIMIT \?/i.test(
            sql,
          )
        ) {
          const [limit] = params as [number]
          const items = state.audit
            .slice()
            .sort((a, b) => b.ts - a.ts)
            .slice(0, limit)
            .map((r) => ({
              user_id: r.user_id,
              ip_hash: r.ip_hash,
              ua_hash: r.ua_hash,
              action: r.action,
              target_id: r.target_id,
              details_json: r.details_json,
              ts: r.ts,
            }))
          return { results: items as T[] }
        }
        if (
          /^SELECT id, title, visibility, version, published_at, republished_at, revoked_at, draft_id, client_request_id FROM published_shares WHERE user_id=\? ORDER BY published_at DESC/i.test(
            sql,
          )
        ) {
          const [uid] = params as [string]
          const items = state.published_shares
            .filter((s) => s.user_id === uid)
            .slice()
            .sort((a, b) => b.published_at - a.published_at)
            .map((s) => ({
              id: s.id,
              title: s.title,
              visibility: s.visibility,
              version: s.version,
              published_at: s.published_at,
              republished_at: s.republished_at,
              revoked_at: s.revoked_at,
              draft_id: s.draft_id ?? null,
              client_request_id: s.client_request_id ?? null,
            }))
          return { results: items as T[] }
        }
        throw new Error(`unmocked all() SQL: ${sql}`)
      },
    }
    return stmt
  }
  const db = {
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const snapshot = structuredClone(state)
      try {
        const results: unknown[] = []
        for (const statement of statements) results.push(await statement.run())
        return results
      } catch (error) {
        Object.assign(state, snapshot)
        throw error
      }
    },
  } as unknown as D1Database
  return { db, state }
}

type R2Object = {
  body: ReadableStream<Uint8Array>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
  httpMetadata?: { contentType?: string }
}

export function makeR2(): {
  bucket: R2Bucket
  store: Map<string, { bytes: Uint8Array; contentType?: string }>
} {
  const store = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  const enc = new TextEncoder()

  function toBytes(body: unknown): Uint8Array {
    if (typeof body === 'string') return enc.encode(body)
    if (body instanceof Uint8Array) return body
    if (body instanceof ArrayBuffer) return new Uint8Array(body)
    if (ArrayBuffer.isView(body)) return new Uint8Array((body as ArrayBufferView).buffer)
    throw new Error('FakeR2: unsupported body type')
  }

  const bucket = {
    async put(key: string, body: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const entry: { bytes: Uint8Array; contentType?: string } = { bytes: toBytes(body) }
      const ct = opts?.httpMetadata?.contentType
      if (ct !== undefined) entry.contentType = ct
      store.set(key, entry)
      return { key }
    },
    async get(
      key: string,
      opts?: { range?: { offset: number; length: number } },
    ): Promise<R2Object | null> {
      const v = store.get(key)
      if (!v) return null
      const bytes = opts?.range
        ? v.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
        : v.bytes
      return {
        get body() {
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes)
              controller.close()
            },
          })
        },
        async text() {
          return new TextDecoder().decode(bytes)
        },
        async arrayBuffer() {
          const copy = new Uint8Array(bytes.byteLength)
          copy.set(bytes)
          return copy.buffer as ArrayBuffer
        },
        ...(v.contentType ? { httpMetadata: { contentType: v.contentType } } : {}),
      }
    },
    async delete(keyOrKeys: string | string[]) {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]
      for (const key of keys) store.delete(key)
    },
    async list(opts?: { prefix?: string; limit?: number; cursor?: string }) {
      // Mirrors the R2 list shape: page through `prefix`-matching keys
      // honoring `limit`, return `truncated: true` + a `cursor` when
      // more pages remain. The deletion-worker's avatar sweep relies on
      // this paging contract; if the fake silently returned
      // `truncated: false` the test would never exercise the cursor
      // loop and a regression there would slip through.
      //
      // R2 cursors are opaque tokens that work even when objects are
      // deleted between pages. We model that by encoding the cursor as
      // the last-returned key — the next page filters strictly greater
      // than that key, which stays correct even after the prior page
      // has been wiped from `store`.
      const prefix = opts?.prefix ?? ''
      const limit = opts?.limit ?? 1000
      const after = opts?.cursor ?? ''
      const matched: string[] = []
      for (const key of store.keys()) {
        if (key.startsWith(prefix) && key > after) matched.push(key)
      }
      matched.sort()
      const slice = matched.slice(0, limit)
      const objects = slice.map((key) => ({ key }))
      if (slice.length < matched.length) {
        return { objects, truncated: true as const, cursor: slice[slice.length - 1] }
      }
      return { objects, truncated: false as const }
    },
  }
  return { bucket: bucket as unknown as R2Bucket, store }
}

function fakeDiscoveryRelevance(
  discovery: HubSessionDiscoveryRow,
  normalizedAuthor: string,
  query: string,
  tokens: readonly string[],
): number {
  const titles = [
    discovery.title.toLowerCase(),
    discoveryLocalizedTitle(discovery.title_json, 'zh'),
  ]
  const summaries = [
    (discovery.summary_text ?? '').toLowerCase(),
    (discovery.summary_text_zh ?? '').toLowerCase(),
  ]
  let score = 0
  if (titles.some((title) => title === query)) score += 10_000
  else if (titles.some((title) => title.includes(query))) score += 5_000
  if (summaries.some((summary) => summary.includes(query))) score += 1_000
  if (normalizedAuthor === query) score += 2_000
  else if (normalizedAuthor.includes(query)) score += 500
  for (const token of tokens) {
    if (titles.some((title) => title.includes(token))) score += 200
    if (summaries.some((summary) => summary.includes(token))) score += 80
    if (normalizedAuthor.includes(token)) score += 100
    if (discovery.search_text.includes(token)) score += 20
  }
  return score
}

function discoveryLocalizedTitle(titleJson: string | null, locale: 'zh'): string {
  if (!titleJson) return ''
  try {
    const value = JSON.parse(titleJson) as Record<string, unknown>
    return typeof value[locale] === 'string' ? value[locale].toLowerCase() : ''
  } catch {
    return ''
  }
}

function fakeDiscoverySortScore(
  discovery: HubSessionDiscoveryRow,
  sort: 'recommended' | 'trending',
  qualifiedReads: number,
  rankedAt: number,
): number {
  const ageDays = Math.max(0, (rankedAt - discovery.published_at) / (24 * 60 * 60 * 1000))
  const reads = Math.max(0, qualifiedReads)
  const score =
    sort === 'recommended'
      ? discovery.quality_score + 8 * Math.log1p(reads) + 12 * 2 ** (-ageDays / 14)
      : Math.log1p(reads) * 2 ** (-ageDays / 7) + 0.05 * discovery.quality_score
  return Math.round(score * 1_000_000)
}

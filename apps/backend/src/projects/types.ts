export type ProjectOwnerKind = 'user' | 'team'

export type ProjectRow = {
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

export type ProjectOwner = {
  kind: ProjectOwnerKind
  id: string
  handle: string
  name: string
  avatar_url: string | null
}

export type ProjectResponse = {
  id: string
  slug: string
  name: string
  description: string | null
  github_url: string | null
  owner: ProjectOwner
  created_at: number
  updated_at: number
  archived_at: number | null
  session_count: number
  /** Live public Project stars. */
  star_count: number
  /** Whether the current actor may change or archive this Project. */
  can_manage: boolean
}

export type ProjectRef = Pick<ProjectResponse, 'id' | 'slug' | 'name' | 'owner'>

export type ProjectTenant = { userId: string; teamId: null } | { userId: null; teamId: string }

export function projectTenant(
  row: Pick<ProjectRow, 'owner_user_id' | 'owner_team_id'>,
): ProjectTenant {
  if (row.owner_team_id !== null) return { userId: null, teamId: row.owner_team_id }
  if (row.owner_user_id !== null) return { userId: row.owner_user_id, teamId: null }
  // The D1 CHECK makes this unreachable. Throwing here keeps malformed fakes
  // and rolling schemas from silently becoming a personal Project.
  throw new TypeError('Project has no owner tenant')
}

import type { HubSessionRow } from './store'

/**
 * Columns appended to Session feed rows so rendering a page never performs
 * Project/author/publication lookups per row.
 */
export type HydratedManagedSessionRow = HubSessionRow & {
  team_name?: string | null
  star_count?: number
  managed_published: number
  managed_published_at: number | null
  managed_author_handle: string | null
  managed_author_name: string | null
  managed_author_display_name: string | null
  managed_author_avatar_url: string | null
  managed_author_custom_avatar_id: string | null
  managed_author_avatar_visible: number
  managed_project_slug: string
  managed_project_name: string
  managed_project_owner_user_id: string | null
  managed_project_owner_team_id: string | null
  managed_project_owner_handle: string
  managed_project_owner_name: string
  managed_project_owner_avatar_url: string | null
  managed_project_owner_custom_avatar_id: string | null
  managed_project_owner_avatar_visible: number
}

export function managedSessionProjection(): string {
  return `
    CASE WHEN managed_discovery.sid IS NULL THEN 0 ELSE 1 END AS managed_published,
    managed_discovery.published_at AS managed_published_at,
    managed_author_handle.handle AS managed_author_handle,
    managed_author.name AS managed_author_name,
    managed_author.display_name AS managed_author_display_name,
    managed_author.avatar_url AS managed_author_avatar_url,
    managed_author.custom_avatar_id AS managed_author_custom_avatar_id,
    COALESCE(managed_author.avatar_visible,1) AS managed_author_avatar_visible,
    managed_project.slug AS managed_project_slug,
    managed_project.name AS managed_project_name,
    managed_project.owner_user_id AS managed_project_owner_user_id,
    managed_project.owner_team_id AS managed_project_owner_team_id,
    managed_project_owner_handle.handle AS managed_project_owner_handle,
    CASE
      WHEN managed_project.owner_team_id IS NOT NULL THEN managed_project_team.name
      ELSE COALESCE(
        managed_project_user.display_name,
        managed_project_user.name,
        CASE
          WHEN instr(managed_project_user.email,'@')>0
            THEN substr(managed_project_user.email,1,instr(managed_project_user.email,'@')-1)
          ELSE managed_project_user.email
        END,
        managed_project_owner_handle.handle
      )
    END AS managed_project_owner_name,
    managed_project_user.avatar_url AS managed_project_owner_avatar_url,
    managed_project_user.custom_avatar_id AS managed_project_owner_custom_avatar_id,
    COALESCE(managed_project_user.avatar_visible,1) AS managed_project_owner_avatar_visible`
}

export function managedSessionJoins(sessionAlias = 's', preserveEmpty = false): string {
  const join = preserveEmpty ? 'LEFT JOIN' : 'JOIN'
  return `
    ${join} projects managed_project ON managed_project.id=${sessionAlias}.project_id
    ${join} users managed_author ON managed_author.id=${sessionAlias}.owner_user_id
    LEFT JOIN hub_session_discovery managed_discovery ON managed_discovery.sid=${sessionAlias}.sid
    LEFT JOIN handles managed_author_handle ON managed_author_handle.handle=(
      SELECT MIN(candidate.handle)
      FROM handles candidate
      WHERE candidate.user_id=${sessionAlias}.owner_user_id
        AND candidate.released_at IS NULL
    )
    LEFT JOIN users managed_project_user
      ON managed_project_user.id=managed_project.owner_user_id
    LEFT JOIN teams managed_project_team
      ON managed_project_team.id=managed_project.owner_team_id
    ${join} handles managed_project_owner_handle ON managed_project_owner_handle.handle=(
      SELECT MIN(candidate.handle)
      FROM handles candidate
      WHERE candidate.released_at IS NULL
        AND candidate.user_id IS managed_project.owner_user_id
        AND candidate.team_id IS managed_project.owner_team_id
    )`
}

export function isHydratedManagedSessionRow(
  row: HubSessionRow | HydratedManagedSessionRow,
): row is HydratedManagedSessionRow {
  return 'managed_project_slug' in row && 'managed_project_owner_handle' in row
}

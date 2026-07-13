import type Database from 'better-sqlite3'
import type { ProjectGroup, ProjectGroupWithPaths, ProjectIdentityKind, SessionSource } from '../types.js'

export function listProjectGroups(db: Database.Database): ProjectGroup[]
export function listProjectGroups(db: Database.Database, opts: { withPaths: true }): ProjectGroupWithPaths[]
export function listProjectGroups(
  db: Database.Database,
  opts?: { withPaths?: boolean },
): ProjectGroup[] {
  const withPaths = opts?.withPaths === true
  const rows = db.prepare(`
    SELECT identity_kind, identity_key, display_name, sources_csv,
           ${withPaths ? 'display_paths_json, cwds_json,' : ''}
           session_count, last_session_at
    FROM project_groups_v
    ORDER BY
      CASE identity_kind WHEN 'loose' THEN 1 ELSE 0 END,
      last_session_at IS NULL,
      last_session_at DESC
  `).all() as Array<{
    identity_kind: ProjectIdentityKind
    identity_key: string
    display_name: string
    sources_csv: string | null
    display_paths_json?: string | null
    cwds_json?: string | null
    session_count: number
    last_session_at: string | null
  }>
  return rows.map(r => {
    const group: ProjectGroup = {
      identityKind: r.identity_kind,
      identityKey: r.identity_key,
      displayName: r.display_name,
      sources: (r.sources_csv ?? '').split(',').filter(Boolean) as SessionSource[],
      sessionCount: r.session_count,
      lastSessionAt: r.last_session_at,
    }
    if (!withPaths) return group
    return {
      ...group,
      displayPaths: parseStringArray(r.display_paths_json ?? null),
      cwds: parseStringArray(r.cwds_json ?? null),
    } satisfies ProjectGroupWithPaths
  })
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
}

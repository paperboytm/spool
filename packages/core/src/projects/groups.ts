import type Database from 'better-sqlite3'
import type { ProjectGroup, ProjectIdentityKind, SessionSource } from '../types.js'

export function listProjectGroups(db: Database.Database): ProjectGroup[] {
  const rows = db.prepare(`
    SELECT
      p.identity_kind,
      p.identity_key,
      MIN(p.display_name) AS display_name,
      GROUP_CONCAT(DISTINCT src.name) AS sources_csv,
      JSON_GROUP_ARRAY(DISTINCT p.display_path) FILTER (WHERE p.display_path IS NOT NULL AND p.display_path <> '') AS display_paths_json,
      JSON_GROUP_ARRAY(DISTINCT s.cwd) FILTER (WHERE s.cwd IS NOT NULL AND s.cwd <> '') AS cwds_json,
      COUNT(s.id) AS session_count,
      MAX(s.started_at) AS last_session_at
    FROM projects p
    JOIN sources src ON src.id = p.source_id
    LEFT JOIN sessions s ON s.project_id = p.id AND s.message_count > 0
    WHERE p.identity_kind IS NOT NULL
    GROUP BY p.identity_kind, p.identity_key
    ORDER BY
      CASE identity_kind WHEN 'loose' THEN 1 ELSE 0 END,
      last_session_at IS NULL,
      last_session_at DESC
  `).all() as Array<{
    identity_kind: ProjectIdentityKind
    identity_key: string
    display_name: string
    sources_csv: string | null
    display_paths_json: string | null
    cwds_json: string | null
    session_count: number
    last_session_at: string | null
  }>
  return rows.map(r => ({
    identityKind: r.identity_kind,
    identityKey: r.identity_key,
    displayName: r.display_name,
    displayPaths: parseStringArray(r.display_paths_json),
    cwds: parseStringArray(r.cwds_json),
    sources: (r.sources_csv ?? '').split(',').filter(Boolean) as SessionSource[],
    sessionCount: r.session_count,
    lastSessionAt: r.last_session_at,
  }))
}

function parseStringArray(value: string | null): string[] {
  if (!value) return []
  const parsed = JSON.parse(value) as unknown
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string' && v.length > 0) : []
}

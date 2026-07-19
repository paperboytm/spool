import type { D1Database } from '@cloudflare/workers-types'
import type { SessionProvider } from '@spool-lab/session-kit'

export type DiscoveryCandidateRow = {
  sid: string
  title: string
  summary_text: string | null
  search_text: string
  agent: SessionProvider
  message_count: number
  tool_call_count: number
  file_count: number
  additions: number
  deletions: number
  lineage_source_sid: string | null
  quality_score: number
  published_at: number
  updated_at: number
  record_count: number
  owner_user_id: string
  handle: string | null
  name: string | null
  display_name: string | null
  avatar_url: string | null
  custom_avatar_id: string | null
  avatar_visible: number
  qualified_reads_7d: number
}

export async function listDiscoveryCandidates(
  db: D1Database,
  options: {
    sinceDay: string
    agent: SessionProvider | null
    tokens: readonly string[]
    limit: number
  },
): Promise<DiscoveryCandidateRow[]> {
  const conditions = ["s.visibility = 'unlisted'", 's.withdrawn_at IS NULL', 'u.deleted_at IS NULL']
  const params: unknown[] = [options.sinceDay]

  if (options.agent !== null) {
    conditions.push('d.agent = ?')
    params.push(options.agent)
  }

  for (const token of options.tokens) {
    conditions.push(
      "(d.search_text LIKE ? ESCAPE '\\' OR " +
        "LOWER(COALESCE(h.handle, '')) LIKE ? ESCAPE '\\' OR " +
        "LOWER(COALESCE(u.display_name, u.name, '')) LIKE ? ESCAPE '\\')",
    )
    const pattern = `%${escapeLike(token)}%`
    params.push(pattern, pattern, pattern)
  }

  params.push(options.limit)
  const result = await db
    .prepare(
      `/* discovery:list */
       SELECT
         d.sid,
         d.title,
         d.summary_text,
         d.search_text,
         d.agent,
         d.message_count,
         d.tool_call_count,
         d.file_count,
         d.additions,
         d.deletions,
         d.lineage_source_sid,
         d.quality_score,
         d.published_at,
         d.updated_at,
         s.record_count,
         s.owner_user_id,
         h.handle,
         u.name,
         u.display_name,
         u.avatar_url,
         u.custom_avatar_id,
         u.avatar_visible,
         COALESCE((
           SELECT SUM(e.qualified_reads)
           FROM hub_session_engagement_daily e
           WHERE e.sid = d.sid AND e.day >= ?
         ), 0) AS qualified_reads_7d
       FROM hub_session_discovery d
       JOIN hub_sessions s ON s.sid = d.sid
       JOIN users u ON u.id = s.owner_user_id
       LEFT JOIN handles h ON h.user_id = s.owner_user_id AND h.released_at IS NULL
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.published_at DESC, d.sid ASC
       LIMIT ?`,
    )
    .bind(...params)
    .all<DiscoveryCandidateRow>()
  return result.results
}

export async function isDiscoverySessionLive(db: D1Database, sid: string): Promise<boolean> {
  const row = await db
    .prepare(
      `/* discovery:session-live */
       SELECT 1
       FROM hub_sessions s
       JOIN users u ON u.id = s.owner_user_id
       WHERE s.sid = ?
         AND s.visibility = 'unlisted'
         AND s.withdrawn_at IS NULL
         AND u.deleted_at IS NULL`,
    )
    .bind(sid)
    .first()
  return row !== null
}

export async function incrementQualifiedRead(
  db: D1Database,
  sid: string,
  day: string,
): Promise<void> {
  await db
    .prepare(
      '/* discovery:increment-engagement */ ' +
        'INSERT INTO hub_session_engagement_daily (sid, day, qualified_reads) VALUES (?,?,1) ' +
        'ON CONFLICT(sid, day) DO UPDATE SET qualified_reads=qualified_reads+1',
    )
    .bind(sid, day)
    .run()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

import type { D1Database } from '@cloudflare/workers-types'
import type { DiscoverySort, SessionProvider } from '@spool-lab/session-kit'

export type DiscoveryCandidateRow = {
  sid: string
  title: string
  title_json: string | null
  cost_usd: number | null
  total_tokens: number | null
  summary_text: string | null
  summary_text_zh: string | null
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
  project_id: string | null
  project_slug: string | null
  project_name: string | null
  project_owner_kind: 'user' | 'team' | null
  project_owner_handle: string | null
  handle: string | null
  name: string | null
  display_name: string | null
  avatar_url: string | null
  custom_avatar_id: string | null
  avatar_visible: number
  qualified_reads_7d: number
  star_count: number
}

export type DiscoveryPageKey = {
  rankedAt: number
  relevanceScore: number
  sortScore: number | null
  publishedAt: number
  sid: string
}

export type DiscoveryPageRow = DiscoveryCandidateRow & {
  relevance_score: number
  sort_score: number | null
}

/**
 * Lists one globally ordered page. Filtering, ranking, and keyset pagination
 * all happen inside one D1 statement; the application never truncates a
 * recent candidate set before applying Top/search ordering.
 */
export async function listDiscoveryPage(
  db: D1Database,
  options: {
    query: string | null
    tokens: readonly string[]
    sort: DiscoverySort
    agent: SessionProvider | null
    rankedAt: number
    engagementFromDay: string
    engagementToDayExclusive: string
    after: DiscoveryPageKey | null
    limit: number
  },
): Promise<DiscoveryPageRow[]> {
  const ranked = options.sort !== 'recent'
  const marker =
    `/* discovery:list-page sort=${options.sort}` +
    ` query=${options.query === null ? 0 : 1}` +
    ` tokens=${options.tokens.length}` +
    ` agent=${options.agent ?? 'all'} */`
  const conditions = [
    "s.visibility = 'unlisted'",
    's.withdrawn_at IS NULL',
    `(
      (s.team_id IS NULL AND u.deleted_at IS NULL)
      OR
      (s.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
    )`,
  ]
  const params: unknown[] = []

  if (options.agent !== null) {
    conditions.push('d.agent = ?')
    params.push(options.agent)
  }

  for (const token of options.tokens) {
    conditions.push(
      '(instr(d.search_text, ?) > 0 OR ' +
        "(u.deleted_at IS NULL AND instr(LOWER(COALESCE(h.handle, '')), ?) > 0) OR " +
        "(u.deleted_at IS NULL AND instr(LOWER(COALESCE(u.display_name, u.name, '')), ?) > 0))",
    )
    params.push(token, token, token)
  }

  // published_at is server-authored, so this freezes newly-created Sessions
  // out of an in-flight cursor walk. updated_at excludes projections rewritten
  // after the walk began, which prevents a re-share from moving an already
  // visited row behind the cursor. Visibility remains checked live because
  // Public -> Team/private transitions must disappear immediately.
  conditions.push('d.published_at <= ?')
  params.push(options.rankedAt)
  conditions.push('d.updated_at <= ?')
  params.push(options.rankedAt)

  const normalizedTitle = 'base.normalized_title'
  const normalizedTitleZh = 'base.normalized_title_zh'
  const normalizedSummary = 'base.normalized_summary'
  const normalizedSummaryZh = 'base.normalized_summary_zh'
  const normalizedAuthor = 'base.normalized_author'
  let relevanceExpression = '0'
  // Recent is an honest chronological order even while search is active.
  // The token predicates above still restrict it to matching Sessions; only
  // Top uses relevance to rank those matches.
  if (options.query !== null && options.sort !== 'recent') {
    relevanceExpression =
      `CASE WHEN ${normalizedTitle} = ? OR ${normalizedTitleZh} = ? THEN 10000 ` +
      `WHEN instr(${normalizedTitle}, ?) > 0 OR instr(${normalizedTitleZh}, ?) > 0 ` +
      `THEN 5000 ELSE 0 END + ` +
      `CASE WHEN instr(${normalizedSummary}, ?) > 0 OR instr(${normalizedSummaryZh}, ?) > 0 ` +
      `THEN 1000 ELSE 0 END + ` +
      `CASE WHEN ${normalizedAuthor} = ? THEN 2000 ` +
      `WHEN instr(${normalizedAuthor}, ?) > 0 THEN 500 ELSE 0 END`
    params.push(
      options.query,
      options.query,
      options.query,
      options.query,
      options.query,
      options.query,
      options.query,
      options.query,
    )
    for (const token of options.tokens) {
      relevanceExpression +=
        ` + CASE WHEN instr(${normalizedTitle}, ?) > 0 OR instr(${normalizedTitleZh}, ?) > 0 ` +
        `THEN 200 ELSE 0 END` +
        ` + CASE WHEN instr(${normalizedSummary}, ?) > 0 ` +
        `OR instr(${normalizedSummaryZh}, ?) > 0 THEN 80 ELSE 0 END` +
        ` + CASE WHEN instr(${normalizedAuthor}, ?) > 0 THEN 100 ELSE 0 END` +
        ' + CASE WHEN instr(base.search_text, ?) > 0 THEN 20 ELSE 0 END'
      params.push(token, token, token, token, token, token)
    }
  }

  let sortScoreExpression = 'NULL'
  if (options.sort === 'recommended') {
    sortScoreExpression =
      'CAST(ROUND(1000000.0 * (' +
      'base.quality_score + ' +
      '8.0 * ln(1.0 + MAX(0, base.qualified_reads_7d)) + ' +
      '12.0 * pow(2.0, -MAX(0.0, (? - base.published_at) / 86400000.0) / 14.0)' +
      ')) AS INTEGER)'
    params.push(options.rankedAt)
  } else if (options.sort === 'trending') {
    sortScoreExpression =
      'CAST(ROUND(1000000.0 * (' +
      'ln(1.0 + MAX(0, base.qualified_reads_7d)) * ' +
      'pow(2.0, -MAX(0.0, (? - base.published_at) / 86400000.0) / 7.0) + ' +
      '0.05 * base.quality_score' +
      ')) AS INTEGER)'
    params.push(options.rankedAt)
  }

  const after = options.after
  params.push(
    after === null ? 0 : 1,
    after?.relevanceScore ?? 0,
    after?.sortScore ?? 0,
    after?.publishedAt ?? 0,
    after?.sid ?? '',
  )
  const afterCondition =
    options.sort === 'recent'
      ? `(
          cursor.has_after = 0
          OR scored.relevance_score < cursor.relevance_score
          OR (
            scored.relevance_score = cursor.relevance_score
            AND scored.published_at < cursor.published_at
          )
          OR (
            scored.relevance_score = cursor.relevance_score
            AND scored.published_at = cursor.published_at
            AND scored.sid > cursor.sid
          )
        )`
      : `(
          cursor.has_after = 0
          OR scored.relevance_score < cursor.relevance_score
          OR (
            scored.relevance_score = cursor.relevance_score
            AND scored.sort_score < cursor.sort_score
          )
          OR (
            scored.relevance_score = cursor.relevance_score
            AND scored.sort_score = cursor.sort_score
            AND scored.published_at < cursor.published_at
          )
          OR (
            scored.relevance_score = cursor.relevance_score
            AND scored.sort_score = cursor.sort_score
            AND scored.published_at = cursor.published_at
            AND scored.sid > cursor.sid
          )
        )`
  params.push(options.limit + 1)

  const engagementCte = ranked
    ? `engagement AS (
         SELECT sid, SUM(qualified_reads) AS qualified_reads_7d
         FROM hub_session_engagement_daily
         WHERE day >= ? AND day < ?
         GROUP BY sid
       ),`
    : ''
  if (ranked) {
    // The engagement CTE appears before all other placeholders in SQL.
    params.unshift(options.engagementFromDay, options.engagementToDayExclusive)
  }
  const engagementJoin = ranked ? 'LEFT JOIN engagement e ON e.sid = d.sid' : ''
  const qualifiedReads = ranked ? 'COALESCE(e.qualified_reads_7d, 0)' : '0'

  const result = await db
    .prepare(
      `${marker}
       WITH
       ${engagementCte}
       base AS (
         SELECT
           d.sid,
           d.title,
           d.title_json,
           d.cost_usd,
           d.total_tokens,
           d.summary_text,
           d.summary_text_zh,
           d.search_text,
           d.agent,
           d.message_count,
           d.tool_call_count,
           d.file_count,
           d.additions,
           d.deletions,
           d.lineage_source_sid AS projected_lineage_source_sid,
           d.quality_score,
           d.published_at,
           d.updated_at,
           s.record_count,
           s.owner_user_id,
           project.id AS project_id,
           project.slug AS project_slug,
           project.name AS project_name,
           CASE WHEN project.owner_team_id IS NULL THEN 'user' ELSE 'team' END
             AS project_owner_kind,
           project_owner_handle.handle AS project_owner_handle,
           CASE WHEN u.deleted_at IS NULL THEN h.handle ELSE NULL END AS handle,
           CASE WHEN u.deleted_at IS NULL THEN u.name ELSE NULL END AS name,
           CASE WHEN u.deleted_at IS NULL THEN u.display_name ELSE NULL END AS display_name,
           CASE WHEN u.deleted_at IS NULL THEN u.avatar_url ELSE NULL END AS avatar_url,
           CASE WHEN u.deleted_at IS NULL THEN u.custom_avatar_id ELSE NULL END AS custom_avatar_id,
           CASE WHEN u.deleted_at IS NULL THEN u.avatar_visible ELSE 0 END AS avatar_visible,
           ${qualifiedReads} AS qualified_reads_7d,
           LOWER(d.title) AS normalized_title,
           LOWER(COALESCE(json_extract(d.title_json, '$.zh'), '')) AS normalized_title_zh,
           LOWER(COALESCE(d.summary_text, '')) AS normalized_summary,
           LOWER(COALESCE(d.summary_text_zh, '')) AS normalized_summary_zh,
           CASE WHEN u.deleted_at IS NULL
             THEN LOWER(TRIM(
               COALESCE(h.handle, '') || ' ' || COALESCE(u.display_name, u.name, '')
             ))
             ELSE ''
           END AS normalized_author
         FROM hub_session_discovery d
         JOIN hub_sessions s ON s.sid = d.sid
         JOIN projects project ON project.id=s.project_id
         JOIN handles project_owner_handle ON project_owner_handle.handle=(
           SELECT MIN(candidate.handle)
           FROM handles candidate
           WHERE candidate.released_at IS NULL
             AND candidate.user_id IS project.owner_user_id
             AND candidate.team_id IS project.owner_team_id
         )
         JOIN users u ON u.id = s.owner_user_id
         LEFT JOIN teams owning_team ON owning_team.id=s.team_id
           AND owning_team.archived_at IS NULL
           AND owning_team.deletion_pending_until IS NULL
         LEFT JOIN handles h ON h.handle = (
           SELECT MIN(active_handle.handle)
           FROM handles active_handle
           WHERE active_handle.user_id=s.owner_user_id
             AND active_handle.released_at IS NULL
         )
         ${engagementJoin}
         WHERE ${conditions.join(' AND ')}
       ),
       scored AS (
         SELECT
           base.*,
           ${relevanceExpression} AS relevance_score,
           ${sortScoreExpression} AS sort_score
         FROM base
       ),
       cursor(has_after, relevance_score, sort_score, published_at, sid) AS (
         VALUES (?, ?, ?, ?, ?)
       ),
       page AS (
         SELECT scored.*
         FROM scored CROSS JOIN cursor
         WHERE ${afterCondition}
         ORDER BY
           scored.relevance_score DESC,
           scored.sort_score DESC,
           scored.published_at DESC,
           scored.sid ASC
         LIMIT ?
       )
       SELECT
         d.sid,
         d.title,
         d.title_json,
         d.cost_usd,
         d.total_tokens,
         d.summary_text,
         d.summary_text_zh,
         d.search_text,
         d.agent,
         d.message_count,
         d.tool_call_count,
         d.file_count,
         d.additions,
         d.deletions,
         CASE
           WHEN lineage_projection.sid IS NOT NULL
             AND lineage_session.visibility='unlisted'
             AND lineage_session.withdrawn_at IS NULL
             AND (
               (lineage_session.team_id IS NULL AND lineage_user.deleted_at IS NULL)
               OR
               (lineage_session.team_id IS NOT NULL AND lineage_team.id IS NOT NULL)
             )
           THEN d.projected_lineage_source_sid
           ELSE NULL
         END AS lineage_source_sid,
         d.quality_score,
         d.published_at,
         d.updated_at,
         d.record_count,
         d.owner_user_id,
         d.project_id,
         d.project_slug,
         d.project_name,
         d.project_owner_kind,
         d.project_owner_handle,
         d.handle,
         d.name,
         d.display_name,
         d.avatar_url,
         d.custom_avatar_id,
         d.avatar_visible,
         d.qualified_reads_7d,
         (
           SELECT COUNT(*)
           FROM hub_session_stars star
           WHERE star.sid=d.sid
         ) AS star_count,
         d.relevance_score,
         d.sort_score
       FROM page d
       LEFT JOIN hub_sessions lineage_session
         ON lineage_session.sid=d.projected_lineage_source_sid
       LEFT JOIN hub_session_discovery lineage_projection
         ON lineage_projection.sid=lineage_session.sid
       LEFT JOIN users lineage_user ON lineage_user.id=lineage_session.owner_user_id
       LEFT JOIN teams lineage_team ON lineage_team.id=lineage_session.team_id
         AND lineage_team.archived_at IS NULL
         AND lineage_team.deletion_pending_until IS NULL
       ORDER BY
         d.relevance_score DESC,
         d.sort_score DESC,
         d.published_at DESC,
         d.sid ASC`,
    )
    .bind(...params)
    .all<DiscoveryPageRow>()
  return result.results
}

export async function isDiscoverySessionLive(db: D1Database, sid: string): Promise<boolean> {
  const row = await db
    .prepare(
      `/* discovery:session-live */
       SELECT 1
       FROM hub_sessions s
       JOIN hub_session_discovery d ON d.sid=s.sid
       JOIN users u ON u.id = s.owner_user_id
       LEFT JOIN teams owning_team ON owning_team.id=s.team_id
         AND owning_team.archived_at IS NULL
         AND owning_team.deletion_pending_until IS NULL
       WHERE s.sid = ?
         AND s.visibility = 'unlisted'
         AND s.withdrawn_at IS NULL
         AND (
           (s.team_id IS NULL AND u.deleted_at IS NULL)
           OR
           (s.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
         )`,
    )
    .bind(sid)
    .first()
  return row !== null
}

export async function incrementQualifiedReadIfLive(
  db: D1Database,
  sid: string,
  day: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `/* discovery:increment-engagement-if-live */
       INSERT INTO hub_session_engagement_daily (sid, day, qualified_reads)
       SELECT s.sid, ?, 1
       FROM hub_sessions s
       JOIN hub_session_discovery d ON d.sid=s.sid
       JOIN users u ON u.id=s.owner_user_id
       LEFT JOIN teams owning_team ON owning_team.id=s.team_id
         AND owning_team.archived_at IS NULL
         AND owning_team.deletion_pending_until IS NULL
       WHERE s.sid=?
         AND s.visibility='unlisted'
         AND s.withdrawn_at IS NULL
         AND (
           (s.team_id IS NULL AND u.deleted_at IS NULL)
           OR
           (s.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
         )
       ON CONFLICT(sid, day)
       DO UPDATE SET qualified_reads=qualified_reads+1`,
    )
    .bind(day, sid)
    .run()
  return result.meta.changes > 0
}

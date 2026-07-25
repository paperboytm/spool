import type { D1Database } from '@cloudflare/workers-types'
import type { DiscoverySessionSocialResponse } from '@spool-lab/session-kit'

import { ApiError } from '../errors'

type SocialRow = {
  star_count: number
  fork_count: number
  viewer_starred: number
}

/**
 * Reads social state only through the same live-Public boundary as Explore.
 * Fork counts use only one-use, server-issued Resume grants claimed by a
 * child head. Legacy/client-asserted lineage remains visible but is not a
 * countable provenance signal.
 */
export async function getDiscoverySessionSocial(
  db: D1Database,
  sid: string,
  viewerUserId: string | null,
): Promise<DiscoverySessionSocialResponse> {
  const row = await db
    .prepare(
      `/* discovery:social */
       WITH target AS (
         SELECT session.sid
         FROM hub_sessions session
         JOIN hub_session_discovery projection ON projection.sid=session.sid
         JOIN users author ON author.id=session.owner_user_id
         LEFT JOIN teams owning_team ON owning_team.id=session.team_id
           AND owning_team.archived_at IS NULL
           AND owning_team.deletion_pending_until IS NULL
         WHERE session.sid=?
           AND session.visibility='unlisted'
           AND session.withdrawn_at IS NULL
           AND (
             (session.team_id IS NULL AND author.deleted_at IS NULL)
             OR
             (session.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
           )
       )
       SELECT
         (
           SELECT COUNT(*)
           FROM hub_session_stars star
           WHERE star.sid=target.sid
         ) AS star_count,
         (
           SELECT COUNT(*)
           FROM hub_session_verified_forks verified
           JOIN hub_sessions child ON child.sid=verified.child_sid
           JOIN hub_session_discovery child_projection ON child_projection.sid=child.sid
           JOIN users child_author ON child_author.id=child.owner_user_id
           LEFT JOIN teams child_team ON child_team.id=child.team_id
             AND child_team.archived_at IS NULL
             AND child_team.deletion_pending_until IS NULL
           WHERE verified.source_sid=target.sid
             AND child.sid<>target.sid
             AND child.visibility='unlisted'
             AND child.withdrawn_at IS NULL
             AND (
               (child.team_id IS NULL AND child_author.deleted_at IS NULL)
               OR
               (child.team_id IS NOT NULL AND child_team.id IS NOT NULL)
             )
         ) AS fork_count,
         CASE
           WHEN ? IS NULL THEN 0
           ELSE EXISTS (
             SELECT 1 FROM hub_session_stars viewer_star
             WHERE viewer_star.sid=target.sid AND viewer_star.user_id=?
           )
         END AS viewer_starred
       FROM target`,
    )
    .bind(sid, viewerUserId, viewerUserId)
    .first<SocialRow>()

  if (!row) throw new ApiError('NOT_FOUND')
  return {
    version: 1,
    starCount: Number(row.star_count),
    forkCount: Number(row.fork_count),
    viewerStarred: row.viewer_starred === 1,
    canStar: viewerUserId !== null,
  }
}

/**
 * Idempotently stars a live Public Session. The viewer gate is repeated in
 * D1 so account deletion cannot race an already-authorized request and leave
 * a star owned by a tombstoned user.
 */
export async function starDiscoverySession(
  db: D1Database,
  sid: string,
  userId: string,
  now = Date.now(),
): Promise<DiscoverySessionSocialResponse> {
  await db
    .prepare(
      `/* discovery:add-star-if-live */
       INSERT INTO hub_session_stars (sid, user_id, created_at)
       SELECT session.sid, viewer.id, ?
       FROM hub_sessions session
       JOIN hub_session_discovery projection ON projection.sid=session.sid
       JOIN users author ON author.id=session.owner_user_id
       JOIN users viewer ON viewer.id=?
         AND viewer.deleted_at IS NULL
         AND viewer.deletion_pending_until IS NULL
       LEFT JOIN teams owning_team ON owning_team.id=session.team_id
         AND owning_team.archived_at IS NULL
         AND owning_team.deletion_pending_until IS NULL
       WHERE session.sid=?
         AND session.visibility='unlisted'
         AND session.withdrawn_at IS NULL
         AND (
           (session.team_id IS NULL AND author.deleted_at IS NULL)
           OR
           (session.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
         )
       ON CONFLICT(sid, user_id) DO NOTHING`,
    )
    .bind(now, userId, sid)
    .run()

  const social = await getDiscoverySessionSocial(db, sid, userId)
  if (!social.viewerStarred) throw new ApiError('FORBIDDEN', 'account unavailable')
  return social
}

/** Idempotently removes the viewer's star while the target remains Public. */
export async function unstarDiscoverySession(
  db: D1Database,
  sid: string,
  userId: string,
): Promise<DiscoverySessionSocialResponse> {
  await db
    .prepare(
      `/* discovery:delete-star-if-live */
       DELETE FROM hub_session_stars
       WHERE sid=? AND user_id=?
         AND EXISTS (
           SELECT 1
           FROM hub_sessions session
           JOIN hub_session_discovery projection ON projection.sid=session.sid
           JOIN users author ON author.id=session.owner_user_id
           LEFT JOIN teams owning_team ON owning_team.id=session.team_id
             AND owning_team.archived_at IS NULL
             AND owning_team.deletion_pending_until IS NULL
           WHERE session.sid=hub_session_stars.sid
             AND session.visibility='unlisted'
             AND session.withdrawn_at IS NULL
             AND (
               (session.team_id IS NULL AND author.deleted_at IS NULL)
               OR
               (session.team_id IS NOT NULL AND owning_team.id IS NOT NULL)
             )
         )`,
    )
    .bind(sid, userId)
    .run()

  return getDiscoverySessionSocial(db, sid, userId)
}

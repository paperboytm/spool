import type { D1Database } from '@cloudflare/workers-types'

import { ApiError } from '../errors'
import { resolveDisplayName } from '../profile/display-name'
import { finishSocialListPage, type SocialListOptions, type SocialListPage } from './limits'
import type { SocialIdentity } from './projects'

export type UserFollowTarget = SocialIdentity

export type UserFollowState = {
  version: 1
  followerCount: number
  followingCount: number
  viewerFollowing: boolean
  viewerAuthenticated: boolean
  viewerIsSelf: boolean
  canFollow: boolean
}

type UserTargetRow = {
  id: string
  handle: string
  email: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
  custom_avatar_id: string | null
  avatar_visible: number
}

type FollowStateRow = {
  follower_count: number
  following_count: number
  viewer_following: number
  viewer_authenticated: number
  viewer_is_self: number
  can_follow: number
}

type IdentityRow = UserTargetRow & {
  social_id: string
  social_created_at: number
}

/** Resolves only live personal handles. Team handles are not follow targets. */
export async function resolveUserFollowTarget(
  db: D1Database,
  handle: string,
): Promise<UserFollowTarget | null> {
  const row = await db
    .prepare(
      `/* social:resolve-user */
       SELECT user.id,handle.handle,user.email,user.name,user.display_name,
         user.avatar_url,user.custom_avatar_id,
         COALESCE(user.avatar_visible,1) AS avatar_visible
       FROM handles handle
       JOIN users user ON user.id=handle.user_id
       WHERE handle.handle=?
         AND handle.team_id IS NULL
         AND handle.released_at IS NULL
         AND user.deleted_at IS NULL
         AND user.deletion_pending_until IS NULL
       LIMIT 1`,
    )
    .bind(handle)
    .first<UserTargetRow>()
  return row ? serializeIdentity(row) : null
}

export async function getUserFollowState(
  db: D1Database,
  target: UserFollowTarget,
  viewerUserId: string | null,
): Promise<UserFollowState> {
  const row = await db
    .prepare(
      `/* social:user-state */
       WITH target AS (
         SELECT id
         FROM users
         WHERE id=? AND deleted_at IS NULL AND deletion_pending_until IS NULL
       ),
       viewer AS (
         SELECT id
         FROM users
         WHERE id=? AND deleted_at IS NULL AND deletion_pending_until IS NULL
       )
       SELECT
         (
           SELECT COUNT(*)
           FROM user_follows relation
           JOIN users follower ON follower.id=relation.follower_user_id
             AND follower.deleted_at IS NULL
             AND follower.deletion_pending_until IS NULL
           WHERE relation.followed_user_id=target.id
         ) AS follower_count,
         (
           SELECT COUNT(*)
           FROM user_follows relation
           JOIN users followed ON followed.id=relation.followed_user_id
             AND followed.deleted_at IS NULL
             AND followed.deletion_pending_until IS NULL
           WHERE relation.follower_user_id=target.id
         ) AS following_count,
         EXISTS (
           SELECT 1
           FROM user_follows relation
           WHERE relation.follower_user_id=(SELECT id FROM viewer)
             AND relation.followed_user_id=target.id
         ) AS viewer_following,
         EXISTS (SELECT 1 FROM viewer) AS viewer_authenticated,
         EXISTS (SELECT 1 FROM viewer WHERE viewer.id=target.id) AS viewer_is_self,
         (
           EXISTS (SELECT 1 FROM viewer)
           AND NOT EXISTS (SELECT 1 FROM viewer WHERE viewer.id=target.id)
         ) AS can_follow
       FROM target`,
    )
    .bind(target.id, viewerUserId)
    .first<FollowStateRow>()
  if (!row) throw new ApiError('NOT_FOUND')
  return {
    version: 1,
    followerCount: Math.max(0, Number(row.follower_count)),
    followingCount: Math.max(0, Number(row.following_count)),
    viewerFollowing: row.viewer_following === 1,
    viewerAuthenticated: row.viewer_authenticated === 1,
    viewerIsSelf: row.viewer_is_self === 1,
    canFollow: row.can_follow === 1,
  }
}

export async function followUser(
  db: D1Database,
  target: UserFollowTarget,
  actorUserId: string,
  now = Date.now(),
): Promise<void> {
  requireDifferentUsers(target.id, actorUserId)
  await db
    .prepare(
      `/* social:add-user-follow */
       INSERT INTO user_follows (follower_user_id,followed_user_id,created_at)
       SELECT actor.id,target.id,?
       FROM users actor
       JOIN users target ON target.id=?
         AND target.deleted_at IS NULL
         AND target.deletion_pending_until IS NULL
       WHERE actor.id=?
         AND actor.deleted_at IS NULL
         AND actor.deletion_pending_until IS NULL
       ON CONFLICT(follower_user_id,followed_user_id) DO NOTHING`,
    )
    .bind(now, target.id, actorUserId)
    .run()
  const state = await getUserFollowState(db, target, actorUserId)
  if (!state.viewerFollowing) throw new ApiError('FORBIDDEN', 'account unavailable')
}

export async function unfollowUser(
  db: D1Database,
  target: UserFollowTarget,
  actorUserId: string,
): Promise<void> {
  requireDifferentUsers(target.id, actorUserId)
  const state = await getUserFollowState(db, target, actorUserId)
  if (!state.canFollow) throw new ApiError('FORBIDDEN', 'account unavailable')
  await db
    .prepare(
      `/* social:delete-user-follow */
       DELETE FROM user_follows
       WHERE follower_user_id=? AND followed_user_id=?`,
    )
    .bind(actorUserId, target.id)
    .run()
}

export function listUserFollowers(
  db: D1Database,
  target: UserFollowTarget,
  options: SocialListOptions,
): Promise<SocialListPage<SocialIdentity>> {
  return listUserRelations(db, target, 'followers', options)
}

export function listUserFollowing(
  db: D1Database,
  target: UserFollowTarget,
  options: SocialListOptions,
): Promise<SocialListPage<SocialIdentity>> {
  return listUserRelations(db, target, 'following', options)
}

async function listUserRelations(
  db: D1Database,
  target: UserFollowTarget,
  direction: 'followers' | 'following',
  options: SocialListOptions,
): Promise<SocialListPage<SocialIdentity>> {
  const relationColumn =
    direction === 'followers' ? 'relation.followed_user_id' : 'relation.follower_user_id'
  const identityColumn =
    direction === 'followers' ? 'relation.follower_user_id' : 'relation.followed_user_id'
  const rows = await db
    .prepare(
      `/* social:list-user-${direction} */
       SELECT user.id AS social_id,relation.created_at AS social_created_at,
         user.id,handle.handle,user.email,user.name,user.display_name,user.avatar_url,
         user.custom_avatar_id,COALESCE(user.avatar_visible,1) AS avatar_visible
       FROM user_follows relation
       JOIN users user ON user.id=${identityColumn}
       JOIN handles handle ON handle.user_id=user.id
         AND handle.team_id IS NULL AND handle.released_at IS NULL
       WHERE ${relationColumn}=?
         AND user.deleted_at IS NULL
         AND user.deletion_pending_until IS NULL
         AND EXISTS (
           SELECT 1 FROM users target
           WHERE target.id=?
             AND target.deleted_at IS NULL
             AND target.deletion_pending_until IS NULL
         )
         AND (
           ?=0 OR relation.created_at<? OR
           (relation.created_at=? AND user.id>?)
         )
       ORDER BY relation.created_at DESC,user.id ASC
       LIMIT ?`,
    )
    .bind(
      target.id,
      target.id,
      options.after === null ? 0 : 1,
      options.after?.createdAt ?? 0,
      options.after?.createdAt ?? 0,
      options.after?.id ?? '',
      options.limit + 1,
    )
    .all<IdentityRow>()
  const page = finishSocialListPage(
    rows.results.map((row) => ({
      social_id: row.social_id,
      social_created_at: row.social_created_at,
      ...serializeIdentity(row),
    })),
    options,
  )
  return {
    rows: page.rows.map(({ social_created_at: _, social_id: __, ...identity }) => identity),
    nextCursor: page.nextCursor,
  }
}

function serializeIdentity(row: UserTargetRow): SocialIdentity {
  return {
    id: row.id,
    handle: row.handle,
    name: resolveDisplayName(row),
    avatar_url: visibleAvatarUrl(row.id, row),
  }
}

function visibleAvatarUrl(
  userId: string,
  row: {
    avatar_url: string | null
    custom_avatar_id: string | null
    avatar_visible: number
  },
): string | null {
  if (row.avatar_visible !== 1) return null
  return row.custom_avatar_id
    ? `/api/avatars/${encodeURIComponent(userId)}?v=${encodeURIComponent(row.custom_avatar_id)}`
    : row.avatar_url
}

function requireDifferentUsers(targetUserId: string, actorUserId: string): void {
  if (targetUserId === actorUserId) {
    throw new ApiError('FORBIDDEN', 'You cannot follow yourself')
  }
}

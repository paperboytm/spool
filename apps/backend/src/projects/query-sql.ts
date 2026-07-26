/**
 * Kept in an import-free module so the exact production query can also be
 * executed by the Wrangler-backed schema smoke test.
 */
export const HUB_PROJECTS_LIST_SQL = `/* projects:list-hub-authorized */
WITH actor AS (
  SELECT id
  FROM users
  WHERE id=? AND deleted_at IS NULL AND deletion_pending_until IS NULL
)
SELECT p.*,
  (SELECT COUNT(*) FROM hub_sessions s
   WHERE s.project_id=p.id AND s.withdrawn_at IS NULL) AS session_count,
  (SELECT COUNT(*) FROM project_stars relation
   JOIN users star_user ON star_user.id=relation.user_id
     AND star_user.deleted_at IS NULL
     AND star_user.deletion_pending_until IS NULL
   WHERE relation.project_id=p.id) AS star_count,
  owner_handle.handle AS owner_handle,
  CASE
    WHEN p.owner_team_id IS NOT NULL THEN owner_team.name
    ELSE COALESCE(
      owner_user.display_name,
      owner_user.name,
      CASE
        WHEN instr(owner_user.email,'@')>0
          THEN substr(owner_user.email,1,instr(owner_user.email,'@')-1)
        ELSE owner_user.email
      END,
      owner_handle.handle
    )
  END AS owner_name,
  owner_user.avatar_url AS owner_avatar_url,
  owner_user.custom_avatar_id AS owner_custom_avatar_id,
  COALESCE(owner_user.avatar_visible,1) AS owner_avatar_visible,
  CASE
    WHEN p.owner_user_id=actor.id THEN 1
    WHEN membership.role IN ('owner','admin') THEN 1
    ELSE 0
  END AS can_manage
FROM actor
JOIN projects p ON (
  p.owner_user_id=actor.id
  OR EXISTS (
    SELECT 1
    FROM team_memberships current_membership
    JOIN teams current_team ON current_team.id=current_membership.team_id
    WHERE current_membership.user_id=actor.id
      AND current_membership.team_id=p.owner_team_id
      AND current_team.archived_at IS NULL
      AND current_team.deletion_pending_until IS NULL
  )
)
LEFT JOIN team_memberships membership
  ON membership.team_id=p.owner_team_id AND membership.user_id=actor.id
LEFT JOIN users owner_user ON owner_user.id=p.owner_user_id
LEFT JOIN teams owner_team ON owner_team.id=p.owner_team_id
JOIN handles owner_handle ON owner_handle.handle=(
  SELECT MIN(candidate.handle)
  FROM handles candidate
  WHERE candidate.released_at IS NULL
    AND candidate.user_id IS p.owner_user_id
    AND candidate.team_id IS p.owner_team_id
)
WHERE p.archived_at IS NULL
  AND (p.owner_team_id IS NULL
    OR (owner_team.archived_at IS NULL
      AND owner_team.deletion_pending_until IS NULL))
  AND (?=0 OR p.updated_at<? OR (p.updated_at=? AND p.id>?))
ORDER BY p.updated_at DESC, p.id ASC
LIMIT ?`

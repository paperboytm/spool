-- 0015_social_graph.sql
-- Project Stars are public curation, Project Watches are private
-- subscriptions, and User Follows form the public people graph. Team Project
-- relationships remain tenant data unless the Project has a currently-live
-- Discovery Session.

CREATE TABLE project_stars (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_stars_user_created
  ON project_stars(user_id, created_at DESC, project_id);

CREATE TABLE project_watches (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX project_watches_user_created
  ON project_watches(user_id, created_at DESC, project_id);

CREATE TABLE user_follows (
  follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_user_id, followed_user_id),
  CHECK (follower_user_id <> followed_user_id)
);

CREATE INDEX user_follows_followed_created
  ON user_follows(followed_user_id, created_at DESC, follower_user_id);

CREATE INDEX user_follows_follower_created
  ON user_follows(follower_user_id, created_at DESC, followed_user_id);

-- Project URLs are never revived after archival, so their social state must
-- disappear at the same durable transition.
CREATE TRIGGER projects_clear_social_on_archive
AFTER UPDATE OF archived_at ON projects
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  DELETE FROM project_stars WHERE project_id = NEW.id;
  DELETE FROM project_watches WHERE project_id = NEW.id;
END;

-- A former member must not keep or regain a private Team Project Watch after
-- leaving and later rejoining. Public Stars and Watches are independent of
-- membership; only a Watch whose Project currently lacks a live Public
-- Session depended on the private membership grant.
CREATE TRIGGER team_memberships_clear_project_social
AFTER DELETE ON team_memberships
BEGIN
  DELETE FROM project_watches
  WHERE user_id = OLD.user_id
    AND project_id IN (
      SELECT project.id
      FROM projects project
      WHERE project.owner_team_id = OLD.team_id
        AND NOT EXISTS (
          SELECT 1
          FROM hub_sessions live_session
          JOIN hub_session_discovery live_projection
            ON live_projection.sid = live_session.sid
          JOIN users live_author ON live_author.id = live_session.owner_user_id
          LEFT JOIN teams live_team ON live_team.id = live_session.team_id
            AND live_team.archived_at IS NULL
            AND live_team.deletion_pending_until IS NULL
          WHERE live_session.project_id = project.id
            AND live_session.visibility = 'unlisted'
            AND live_session.withdrawn_at IS NULL
            AND (
              (live_session.team_id IS NULL AND live_author.deleted_at IS NULL)
              OR
              (live_session.team_id IS NOT NULL AND live_team.id IS NOT NULL)
            )
        )
    );
END;

-- Users are soft-deleted before their row can ever be removed, so FK cascades
-- alone are insufficient to remove their contribution from live counts.
CREATE TRIGGER users_clear_social_on_delete
AFTER UPDATE OF deleted_at ON users
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  DELETE FROM project_stars WHERE user_id = NEW.id;
  DELETE FROM project_watches WHERE user_id = NEW.id;
  DELETE FROM user_follows
  WHERE follower_user_id = NEW.id OR followed_user_id = NEW.id;

  -- Re-evaluate Projects whose public projection could have depended on this
  -- user. Team-owned Sessions remain live after their author leaves while the
  -- Team is active; the live predicate below deliberately preserves that
  -- durable ownership rule and removes social state only if no Public Session
  -- actually remains.
  DELETE FROM project_stars
  WHERE project_id IN (
    SELECT affected_project.id
    FROM projects affected_project
    WHERE (
        affected_project.owner_user_id = NEW.id OR
        EXISTS (
          SELECT 1 FROM hub_sessions authored_session
          WHERE authored_session.project_id = affected_project.id
            AND authored_session.owner_user_id = NEW.id
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM hub_sessions live_session
        JOIN hub_session_discovery live_projection
          ON live_projection.sid = live_session.sid
        JOIN users live_author ON live_author.id = live_session.owner_user_id
        LEFT JOIN teams live_team ON live_team.id = live_session.team_id
          AND live_team.archived_at IS NULL
          AND live_team.deletion_pending_until IS NULL
        WHERE live_session.project_id = affected_project.id
          AND live_session.visibility = 'unlisted'
          AND live_session.withdrawn_at IS NULL
          AND (
            (live_session.team_id IS NULL AND live_author.deleted_at IS NULL)
            OR
            (live_session.team_id IS NOT NULL AND live_team.id IS NOT NULL)
          )
      )
  );

  DELETE FROM project_watches
  WHERE project_id IN (
    SELECT affected_project.id
    FROM projects affected_project
    WHERE (
        affected_project.owner_user_id = NEW.id OR
        EXISTS (
          SELECT 1 FROM hub_sessions authored_session
          WHERE authored_session.project_id = affected_project.id
            AND authored_session.owner_user_id = NEW.id
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM hub_sessions live_session
        JOIN hub_session_discovery live_projection
          ON live_projection.sid = live_session.sid
        JOIN users live_author ON live_author.id = live_session.owner_user_id
        LEFT JOIN teams live_team ON live_team.id = live_session.team_id
          AND live_team.archived_at IS NULL
          AND live_team.deletion_pending_until IS NULL
        WHERE live_session.project_id = affected_project.id
          AND live_session.visibility = 'unlisted'
          AND live_session.withdrawn_at IS NULL
          AND (
            (live_session.team_id IS NULL AND live_author.deleted_at IS NULL)
            OR
            (live_session.team_id IS NOT NULL AND live_team.id IS NOT NULL)
          )
      )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM projects watched_project
    JOIN teams watched_team ON watched_team.id = watched_project.owner_team_id
      AND watched_team.archived_at IS NULL
      AND watched_team.deletion_pending_until IS NULL
    JOIN team_memberships watched_member
      ON watched_member.team_id = watched_team.id
      AND watched_member.user_id = project_watches.user_id
    JOIN users watched_user ON watched_user.id = watched_member.user_id
      AND watched_user.deleted_at IS NULL
      AND watched_user.deletion_pending_until IS NULL
    WHERE watched_project.id = project_watches.project_id
      AND watched_project.archived_at IS NULL
  );
END;

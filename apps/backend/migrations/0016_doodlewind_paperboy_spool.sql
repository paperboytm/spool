-- 0016_doodlewind_paperboy_spool.sql
--
-- Correct the one reviewed production identity split without merging either
-- WorkOS identity or deleting either user. Five Spool Sessions were published
-- by the old Gmail-backed user before the canonical QQ-backed user joined the
-- Paperboy Team. Their immutable Hub objects remain in the Personal index and
-- receive Team aliases; the Session heads move to a Team-owned Spool Project
-- while retaining an individual author.
--
-- Exact ids, emails, upstream identities, Team ownership, Session ids, and
-- Project tenancy are deliberate guards. An empty/fresh database is a no-op.
-- A database containing any part of this reviewed production shape must be
-- wholly in either the pre-migration or post-migration state, otherwise the
-- migration aborts atomically instead of guessing.

CREATE TABLE identity_transfer_scope_0016 (
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);

INSERT INTO identity_transfer_scope_0016 (active)
SELECT CASE
  WHEN
    EXISTS (
      SELECT 1
      FROM users
      WHERE
        id IN ('698b4cbc14e04f44', 'c08e154b2d724bdf') OR
        lower(email) IN ('doodlewind@gmail.com', 'doodlewind@qq.com')
    ) OR
    EXISTS (
      SELECT 1
      FROM teams
      WHERE id = 'team_2013aaa287124e2982e5d980802418b7'
    ) OR
    EXISTS (
      SELECT 1
      FROM projects
      WHERE id IN (
        'project_user_698b4cbc14e04f44_spool',
        'project_team_team_2013aaa287124e2982e5d980802418b7_spool'
      )
    ) OR
    EXISTS (
      SELECT 1
      FROM hub_sessions
      WHERE sid IN (
        'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
        'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
        'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
        'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
        'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
      )
    )
  THEN 1
  ELSE 0
END;

CREATE TABLE identity_transfer_pre_guard_0016 (
  ok INTEGER NOT NULL
    CONSTRAINT identity_transfer_precondition_0016 CHECK (ok = 1)
);

INSERT INTO identity_transfer_pre_guard_0016 (ok)
SELECT CASE
  WHEN
    (SELECT active FROM identity_transfer_scope_0016) = 1 AND
    NOT (
      -- Exact users and upstream identities remain distinct.
      (
        SELECT COUNT(*)
        FROM users
        WHERE
          id = '698b4cbc14e04f44' AND
          lower(email) = 'doodlewind@gmail.com' AND
          deletion_pending_until IS NULL AND
          deleted_at IS NULL
      ) = 1 AND
      (
        SELECT COUNT(*)
        FROM users
        WHERE
          id = 'c08e154b2d724bdf' AND
          lower(email) = 'doodlewind@qq.com' AND
          deletion_pending_until IS NULL AND
          deleted_at IS NULL
      ) = 1 AND
      (
        SELECT COUNT(*)
        FROM users
        WHERE lower(email) = 'doodlewind@gmail.com'
      ) = 1 AND
      (
        SELECT COUNT(*)
        FROM users
        WHERE lower(email) = 'doodlewind@qq.com'
      ) = 1 AND
      EXISTS (
        SELECT 1
        FROM user_identities
        WHERE
          provider = 'workos' AND
          provider_sub = 'user_01KY74NZHXR35SWKKSNCE5YBJ3' AND
          user_id = '698b4cbc14e04f44'
      ) AND
      EXISTS (
        SELECT 1
        FROM user_identities
        WHERE
          provider = 'workos' AND
          provider_sub = 'user_01KY4M15A84VDF48FP6JPFY95W' AND
          user_id = 'c08e154b2d724bdf'
      ) AND
      -- The canonical user is the current owner of the exact live Team.
      EXISTS (
        SELECT 1
        FROM teams
        WHERE
          id = 'team_2013aaa287124e2982e5d980802418b7' AND
          deletion_pending_until IS NULL AND
          archived_at IS NULL
      ) AND
      EXISTS (
        SELECT 1
        FROM team_memberships
        WHERE
          team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
          user_id = 'c08e154b2d724bdf' AND
          role = 'owner'
      ) AND
      EXISTS (
        SELECT 1
        FROM handles
        WHERE
          handle = 'paperboy' AND
          user_id IS NULL AND
          team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
          released_at IS NULL
      ) AND
      -- Existing aliases with the same content id must agree on byte size.
      NOT EXISTS (
        SELECT 1
        FROM hub_objects personal
        JOIN hub_team_objects team_object
          ON
            team_object.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
            team_object.oid = personal.oid
        WHERE
          personal.owner_user_id = '698b4cbc14e04f44' AND
          team_object.size <> personal.size
      ) AND
      -- Account for only not-yet-aliased bytes before invoking the hard quota
      -- trigger, so a quota failure is an intentional migration precondition.
      (
        SELECT
          COALESCE((
            SELECT SUM(size)
            FROM hub_team_objects
            WHERE team_id = 'team_2013aaa287124e2982e5d980802418b7'
          ), 0) +
          COALESCE((
            SELECT SUM(personal.size)
            FROM hub_objects personal
            WHERE
              personal.owner_user_id = '698b4cbc14e04f44' AND
              NOT EXISTS (
                SELECT 1
                FROM hub_team_objects team_object
                WHERE
                  team_object.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
                  team_object.oid = personal.oid
              )
          ), 0)
      ) <= 5368709120 AND
      (
        -- Exact original state.
        (
          EXISTS (
            SELECT 1
            FROM projects
            WHERE
              id = 'project_user_698b4cbc14e04f44_spool' AND
              owner_user_id = '698b4cbc14e04f44' AND
              owner_team_id IS NULL AND
              slug = 'spool' AND
              archived_at IS NULL
          ) AND
          NOT EXISTS (
            SELECT 1
            FROM projects
            WHERE
              id = 'project_team_team_2013aaa287124e2982e5d980802418b7_spool' OR
              (
                owner_user_id IS NULL AND
                owner_team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
                slug = 'spool'
              )
          ) AND
          (
            SELECT COUNT(*)
            FROM hub_sessions
            WHERE project_id = 'project_user_698b4cbc14e04f44_spool'
          ) = 5 AND
          (
            SELECT COUNT(*)
            FROM hub_sessions session
            WHERE
              session.sid IN (
                'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
                'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
                'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
                'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
                'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
              ) AND
              session.owner_user_id = '698b4cbc14e04f44' AND
              session.team_id IS NULL AND
              session.project_id = 'project_user_698b4cbc14e04f44_spool' AND
              session.visibility = 'unlisted' AND
              session.withdrawn_at IS NULL AND
              EXISTS (
                SELECT 1
                FROM hub_session_discovery discovery
                WHERE discovery.sid = session.sid
              )
          ) = 5 AND
          (
            SELECT COUNT(*)
            FROM handles
            WHERE
              handle = 'evan' AND
              user_id = '698b4cbc14e04f44' AND
              team_id IS NULL AND
              released_at IS NULL
          ) = 1 AND
          (
            SELECT COUNT(*)
            FROM handles
            WHERE
              user_id = '698b4cbc14e04f44' AND
              released_at IS NULL
          ) = 1 AND
          NOT EXISTS (
            SELECT 1 FROM handles WHERE handle = 'doodlewind'
          ) AND
          NOT EXISTS (
            SELECT 1
            FROM handles
            WHERE
              user_id = 'c08e154b2d724bdf' AND
              released_at IS NULL
          )
        ) OR
        -- Exact completed state. This makes a deliberate file replay a no-op
        -- while still rejecting a partially-applied/manual transfer.
        (
          EXISTS (
            SELECT 1
            FROM projects
            WHERE
              id = 'project_user_698b4cbc14e04f44_spool' AND
              owner_user_id = '698b4cbc14e04f44' AND
              owner_team_id IS NULL AND
              slug = 'spool' AND
              archived_at IS NOT NULL
          ) AND
          EXISTS (
            SELECT 1
            FROM projects
            WHERE
              id = 'project_team_team_2013aaa287124e2982e5d980802418b7_spool' AND
              owner_user_id IS NULL AND
              owner_team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
              slug = 'spool' AND
              name = 'Spool' AND
              description = 'Spool turns local coding-agent Sessions into durable, shareable records that people can read, search, and resume across tools.' AND
              github_url = 'https://github.com/paperboytm/spool' AND
              created_by_user_id = 'c08e154b2d724bdf' AND
              archived_at IS NULL
          ) AND
          NOT EXISTS (
            SELECT 1
            FROM hub_sessions
            WHERE project_id = 'project_user_698b4cbc14e04f44_spool'
          ) AND
          (
            SELECT COUNT(*)
            FROM hub_sessions session
            WHERE
              session.sid IN (
                'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
                'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
                'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
                'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
                'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
              ) AND
              session.owner_user_id = 'c08e154b2d724bdf' AND
              session.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
              session.project_id =
                'project_team_team_2013aaa287124e2982e5d980802418b7_spool' AND
              session.visibility = 'unlisted' AND
              session.withdrawn_at IS NULL AND
              EXISTS (
                SELECT 1
                FROM hub_session_discovery discovery
                WHERE discovery.sid = session.sid
              )
          ) = 5 AND
          EXISTS (
            SELECT 1
            FROM handles
            WHERE
              handle = 'evan' AND
              user_id = '698b4cbc14e04f44' AND
              team_id IS NULL AND
              released_at IS NOT NULL
          ) AND
          (
            SELECT COUNT(*)
            FROM handles
            WHERE
              handle = 'doodlewind' AND
              user_id = 'c08e154b2d724bdf' AND
              team_id IS NULL AND
              released_at IS NULL
          ) = 1 AND
          NOT EXISTS (
            SELECT 1
            FROM hub_objects personal
            WHERE
              personal.owner_user_id = '698b4cbc14e04f44' AND
              NOT EXISTS (
                SELECT 1
                FROM hub_team_objects team_object
                WHERE
                  team_object.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
                  team_object.oid = personal.oid AND
                  team_object.size = personal.size
              )
          )
        )
      )
    )
  THEN 0
  ELSE 1
END;

DROP TABLE identity_transfer_pre_guard_0016;

INSERT INTO projects (
  id,
  owner_user_id,
  owner_team_id,
  slug,
  name,
  description,
  github_url,
  created_by_user_id,
  created_at,
  updated_at,
  archived_at
)
SELECT
  'project_team_team_2013aaa287124e2982e5d980802418b7_spool',
  NULL,
  'team_2013aaa287124e2982e5d980802418b7',
  'spool',
  'Spool',
  'Spool turns local coding-agent Sessions into durable, shareable records that people can read, search, and resume across tools.',
  'https://github.com/paperboytm/spool',
  'c08e154b2d724bdf',
  MIN(created_at),
  MAX(MAX(updated_at), 1785038400000),
  NULL
FROM hub_sessions
WHERE
  sid IN (
    'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
    'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
    'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
    'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
    'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
  )
HAVING
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  COUNT(*) = 5 AND
  NOT EXISTS (
    SELECT 1
    FROM projects
    WHERE id = 'project_team_team_2013aaa287124e2982e5d980802418b7_spool'
  );

INSERT OR IGNORE INTO hub_team_objects (
  team_id,
  oid,
  size,
  pack_key,
  offset,
  length,
  created_at
)
SELECT
  'team_2013aaa287124e2982e5d980802418b7',
  oid,
  size,
  pack_key,
  offset,
  length,
  created_at
FROM hub_objects
WHERE
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  owner_user_id = '698b4cbc14e04f44';

UPDATE hub_sessions
SET
  owner_user_id = 'c08e154b2d724bdf',
  team_id = 'team_2013aaa287124e2982e5d980802418b7',
  project_id = 'project_team_team_2013aaa287124e2982e5d980802418b7_spool'
WHERE
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  sid IN (
    'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
    'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
    'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
    'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
    'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
  );

UPDATE handles
SET released_at = MAX(claimed_at, 1785038400000)
WHERE
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  handle = 'evan' AND
  user_id = '698b4cbc14e04f44' AND
  team_id IS NULL AND
  released_at IS NULL;

INSERT INTO handles (handle, user_id, team_id, claimed_at, released_at)
SELECT
  'doodlewind',
  'c08e154b2d724bdf',
  NULL,
  1785038400000,
  NULL
WHERE
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  NOT EXISTS (SELECT 1 FROM handles WHERE handle = 'doodlewind');

UPDATE projects
SET
  archived_at = MAX(created_at, 1785038400000),
  updated_at = MAX(updated_at, created_at, 1785038400000)
WHERE
  (SELECT active FROM identity_transfer_scope_0016) = 1 AND
  id = 'project_user_698b4cbc14e04f44_spool' AND
  archived_at IS NULL;

CREATE TABLE identity_transfer_post_guard_0016 (
  ok INTEGER NOT NULL
    CONSTRAINT identity_transfer_postcondition_0016 CHECK (ok = 1)
);

INSERT INTO identity_transfer_post_guard_0016 (ok)
SELECT CASE
  WHEN
    (SELECT active FROM identity_transfer_scope_0016) = 1 AND
    NOT (
      EXISTS (
        SELECT 1
        FROM users
        WHERE
          id = '698b4cbc14e04f44' AND
          lower(email) = 'doodlewind@gmail.com' AND
          deletion_pending_until IS NULL AND
          deleted_at IS NULL
      ) AND
      EXISTS (
        SELECT 1
        FROM users
        WHERE
          id = 'c08e154b2d724bdf' AND
          lower(email) = 'doodlewind@qq.com' AND
          deletion_pending_until IS NULL AND
          deleted_at IS NULL
      ) AND
      EXISTS (
        SELECT 1
        FROM user_identities
        WHERE
          provider = 'workos' AND
          provider_sub = 'user_01KY74NZHXR35SWKKSNCE5YBJ3' AND
          user_id = '698b4cbc14e04f44'
      ) AND
      EXISTS (
        SELECT 1
        FROM user_identities
        WHERE
          provider = 'workos' AND
          provider_sub = 'user_01KY4M15A84VDF48FP6JPFY95W' AND
          user_id = 'c08e154b2d724bdf'
      ) AND
      EXISTS (
        SELECT 1
        FROM projects
        WHERE
          id = 'project_team_team_2013aaa287124e2982e5d980802418b7_spool' AND
          owner_user_id IS NULL AND
          owner_team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
          slug = 'spool' AND
          name = 'Spool' AND
          description = 'Spool turns local coding-agent Sessions into durable, shareable records that people can read, search, and resume across tools.' AND
          github_url = 'https://github.com/paperboytm/spool' AND
          created_by_user_id = 'c08e154b2d724bdf' AND
          archived_at IS NULL
      ) AND
      EXISTS (
        SELECT 1
        FROM projects
        WHERE
          id = 'project_user_698b4cbc14e04f44_spool' AND
          owner_user_id = '698b4cbc14e04f44' AND
          owner_team_id IS NULL AND
          slug = 'spool' AND
          archived_at IS NOT NULL
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM hub_sessions
        WHERE project_id = 'project_user_698b4cbc14e04f44_spool'
      ) AND
      (
        SELECT COUNT(*)
        FROM hub_sessions session
        WHERE
          session.sid IN (
            'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
            'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
            'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
            'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
            'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
          ) AND
          session.owner_user_id = 'c08e154b2d724bdf' AND
          session.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
          session.project_id =
            'project_team_team_2013aaa287124e2982e5d980802418b7_spool' AND
          session.visibility = 'unlisted' AND
          session.withdrawn_at IS NULL AND
          EXISTS (
            SELECT 1
            FROM hub_session_discovery discovery
            WHERE discovery.sid = session.sid
          )
      ) = 5 AND
      EXISTS (
        SELECT 1
        FROM handles
        WHERE
          handle = 'evan' AND
          user_id = '698b4cbc14e04f44' AND
          team_id IS NULL AND
          released_at IS NOT NULL
      ) AND
      (
        SELECT COUNT(*)
        FROM handles
        WHERE
          handle = 'doodlewind' AND
          user_id = 'c08e154b2d724bdf' AND
          team_id IS NULL AND
          released_at IS NULL
      ) = 1 AND
      NOT EXISTS (
        SELECT 1
        FROM handles
        WHERE
          user_id = '698b4cbc14e04f44' AND
          released_at IS NULL
      ) AND
      NOT EXISTS (
        SELECT 1
        FROM hub_objects personal
        WHERE
          personal.owner_user_id = '698b4cbc14e04f44' AND
          NOT EXISTS (
            SELECT 1
            FROM hub_team_objects team_object
            WHERE
              team_object.team_id = 'team_2013aaa287124e2982e5d980802418b7' AND
              team_object.oid = personal.oid AND
              team_object.size = personal.size
          )
      )
    )
  THEN 0
  ELSE 1
END;

DROP TABLE identity_transfer_post_guard_0016;
DROP TABLE identity_transfer_scope_0016;

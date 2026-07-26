-- 0014_projects.sql
--
-- Stable owner handles and hosted Projects.
--
-- A handle is a permanent route identity shared by users and Teams. Releasing
-- a handle retires it; the primary-key tombstone intentionally prevents a
-- different owner from reclaiming an old URL.
--
-- A Project belongs to exactly one tenant. hub_sessions.owner_user_id remains
-- the original human author/writer while hub_sessions.team_id remains the
-- durable Team tenant, so project ownership is represented independently.

-- Rebuild the original user-only handles table in place. No table has an
-- inbound foreign key to handles, so this preserves every historical claim
-- without changing the user/profile query surface.
ALTER TABLE handles RENAME TO handles_legacy_0014;

CREATE TABLE handles (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  claimed_at INTEGER NOT NULL,
  released_at INTEGER,
  CHECK (
    (user_id IS NOT NULL AND team_id IS NULL) OR
    (user_id IS NULL AND team_id IS NOT NULL)
  ),
  CHECK (released_at IS NULL OR released_at >= claimed_at)
);

INSERT INTO handles (handle, user_id, team_id, claimed_at, released_at)
SELECT
  legacy.handle,
  legacy.user_id,
  NULL,
  legacy.claimed_at,
  CASE
    -- The v1 table did not enforce one active handle per user. Retain the
    -- alphabetically first active route (the same deterministic choice used by
    -- public attribution) and preserve any duplicates as retired tombstones.
    WHEN
      legacy.released_at IS NULL AND
      legacy.handle <> (
        SELECT MIN(candidate.handle COLLATE NOCASE)
        FROM handles_legacy_0014 candidate
        WHERE
          candidate.user_id = legacy.user_id AND
          candidate.released_at IS NULL
      )
    THEN legacy.claimed_at
    ELSE legacy.released_at
  END
FROM handles_legacy_0014 legacy;

DROP TABLE handles_legacy_0014;

CREATE INDEX handles_user ON handles(user_id);
CREATE INDEX handles_team ON handles(team_id);
CREATE UNIQUE INDEX handles_active_user
  ON handles(user_id)
  WHERE user_id IS NOT NULL AND released_at IS NULL;
CREATE UNIQUE INDEX handles_active_team
  ON handles(team_id)
  WHERE team_id IS NOT NULL AND released_at IS NULL;

-- Claims are immutable identities. The only lifecycle mutation is the first
-- transition from active to released; once released, a handle remains a
-- permanent tombstone.
CREATE TRIGGER handles_identity_immutable
BEFORE UPDATE OF handle, user_id, team_id ON handles
WHEN
  NEW.handle IS NOT OLD.handle OR
  NEW.user_id IS NOT OLD.user_id OR
  NEW.team_id IS NOT OLD.team_id
BEGIN
  SELECT RAISE(ABORT, 'handle identity is immutable');
END;

CREATE TRIGGER handles_release_monotonic
BEFORE UPDATE OF released_at ON handles
WHEN OLD.released_at IS NOT NULL AND NEW.released_at IS NOT OLD.released_at
BEGIN
  SELECT RAISE(ABORT, 'released handle is a permanent tombstone');
END;

CREATE TRIGGER handles_no_delete
BEFORE DELETE ON handles
BEGIN
  SELECT RAISE(ABORT, 'handle tombstones cannot be deleted');
END;

-- A Team creation operation chooses its route before it creates any WorkOS
-- resources. Existing receipts remain nullable until the backfill at the end
-- of this migration so an in-flight pre-0014 operation can be resumed.
ALTER TABLE team_creation_requests
  ADD COLUMN requested_handle TEXT COLLATE NOCASE
  CHECK (
    requested_handle IS NULL OR (
      length(requested_handle) BETWEEN 3 AND 32 AND
      requested_handle = lower(requested_handle) AND
      substr(requested_handle, 1, 1) GLOB '[a-z]' AND
      requested_handle NOT GLOB '*[^a-z0-9_-]*'
    )
  );

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  owner_team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL COLLATE NOCASE,
  name TEXT NOT NULL,
  description TEXT,
  github_url TEXT,
  created_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  CHECK (
    (owner_user_id IS NOT NULL AND owner_team_id IS NULL) OR
    (owner_user_id IS NULL AND owner_team_id IS NOT NULL)
  ),
  CHECK (
    length(id) BETWEEN 16 AND 200 AND
    id GLOB 'project_*' AND
    id NOT GLOB '*[^0-9A-Za-z_-]*'
  ),
  CHECK (
    length(slug) BETWEEN 1 AND 80 AND
    slug = lower(slug) AND
    slug NOT GLOB '*[^a-z0-9-]*' AND
    substr(slug, 1, 1) GLOB '[a-z0-9]' AND
    substr(slug, -1, 1) GLOB '[a-z0-9]'
  ),
  CHECK (length(trim(name)) BETWEEN 1 AND 120),
  CHECK (updated_at >= created_at),
  CHECK (archived_at IS NULL OR archived_at >= created_at)
);

CREATE UNIQUE INDEX projects_user_slug
  ON projects(owner_user_id, slug)
  WHERE owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX projects_team_slug
  ON projects(owner_team_id, slug)
  WHERE owner_team_id IS NOT NULL;
CREATE INDEX projects_user_updated
  ON projects(owner_user_id, updated_at DESC, id)
  WHERE owner_user_id IS NOT NULL;
CREATE INDEX projects_team_updated
  ON projects(owner_team_id, updated_at DESC, id)
  WHERE owner_team_id IS NOT NULL;

CREATE TRIGGER projects_tenant_immutable
BEFORE UPDATE OF owner_user_id, owner_team_id ON projects
WHEN
  NEW.owner_user_id IS NOT OLD.owner_user_id OR
  NEW.owner_team_id IS NOT OLD.owner_team_id
BEGIN
  SELECT RAISE(ABORT, 'project tenant is immutable');
END;

-- Identity retirement follows the existing soft-delete/archive columns. Team
-- archival happens through several WorkOS reconciliation paths; putting the
-- cleanup here keeps all of them consistent. Unarchiving never revives a
-- retired handle or Project URL.
CREATE TRIGGER users_retire_projects
AFTER UPDATE OF deleted_at ON users
WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
BEGIN
  UPDATE handles
  SET released_at = NEW.deleted_at
  WHERE user_id = NEW.id AND released_at IS NULL;

  UPDATE projects
  SET
    archived_at = NEW.deleted_at,
    updated_at = MAX(updated_at, NEW.deleted_at)
  WHERE owner_user_id = NEW.id AND archived_at IS NULL;
END;

CREATE TRIGGER teams_retire_projects
AFTER UPDATE OF archived_at ON teams
WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL
BEGIN
  UPDATE handles
  SET released_at = NEW.archived_at
  WHERE team_id = NEW.id AND released_at IS NULL;

  UPDATE projects
  SET
    archived_at = NEW.archived_at,
    updated_at = MAX(updated_at, NEW.archived_at)
  WHERE owner_team_id = NEW.id AND archived_at IS NULL;
END;

-- POST /api/hub/v1/projects is idempotent within the actor + owner tenant
-- scope. owner_scope is redundant on purpose: it gives SQLite a non-null
-- composite primary key while the CHECK keeps it derived from the real FKs.
CREATE TABLE project_creation_requests (
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  owner_scope TEXT NOT NULL,
  owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  owner_team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (actor_user_id, owner_scope, idempotency_key),
  UNIQUE (project_id),
  CHECK (
    (
      owner_user_id IS NOT NULL AND
      owner_team_id IS NULL AND
      owner_scope = 'user:' || owner_user_id
    ) OR (
      owner_user_id IS NULL AND
      owner_team_id IS NOT NULL AND
      owner_scope = 'team:' || owner_team_id
    )
  ),
  CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  CHECK (
    length(request_hash) = 64 AND
    request_hash NOT GLOB '*[^0-9a-f]*'
  )
);
CREATE INDEX project_creation_requests_project
  ON project_creation_requests(project_id);

ALTER TABLE hub_sessions
  ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT;

-- Every tenant with an existing Session receives an empty deterministic
-- fallback Project. New Hub code uses the same IDs for old clients that do not
-- yet provide an explicit Project.
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
  'project_default_user_' || s.owner_user_id,
  s.owner_user_id,
  NULL,
  'sessions',
  'Sessions',
  'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
  NULL,
  s.owner_user_id,
  MIN(s.created_at),
  MAX(s.updated_at),
  NULL
FROM hub_sessions s
WHERE s.team_id IS NULL
GROUP BY s.owner_user_id;

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
  'project_default_team_' || s.team_id,
  NULL,
  s.team_id,
  'sessions',
  'Sessions',
  'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
  NULL,
  t.created_by_user_id,
  MIN(s.created_at),
  MAX(s.updated_at),
  NULL
FROM hub_sessions s
JOIN teams t ON t.id = s.team_id
WHERE s.team_id IS NOT NULL
GROUP BY s.team_id, t.created_by_user_id;

-- Known React Vapor Sessions are a reviewed pair from the bilingual production
-- backfill. The SELECT stays tenant-relative so a restored/staging database
-- cannot accidentally attach them to a hard-coded user id.
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
  'project_user_' || s.owner_user_id || '_react-vapor',
  s.owner_user_id,
  NULL,
  'react-vapor',
  'React Vapor',
  'React Vapor explores a compiler-driven React execution model that reduces runtime reconciliation while preserving compatibility with existing React code and third-party packages.',
  NULL,
  s.owner_user_id,
  MIN(s.created_at),
  MAX(s.updated_at),
  NULL
FROM hub_sessions s
WHERE
  s.team_id IS NULL AND
  s.sid IN (
    'claude_52d60289-1a34-41ff-bf63-a77593a53d8a',
    'claude_9cea282a-d9cf-434d-83f4-633cca085faf'
  )
GROUP BY s.owner_user_id;

-- Existing Spool implementation Sessions are grouped by their actual owner.
-- The avatar Session author also receives a personal Spool Project so any of
-- that author's personal Sessions have a stable reviewed destination.
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
  'project_user_' || s.owner_user_id || '_spool',
  s.owner_user_id,
  NULL,
  'spool',
  'Spool',
  'Spool turns local coding-agent Sessions into durable, shareable records that people can read, search, and resume across tools.',
  'https://github.com/paperboytm/spool',
  s.owner_user_id,
  MIN(s.created_at),
  MAX(s.updated_at),
  NULL
FROM hub_sessions s
WHERE s.owner_user_id IN (
  SELECT owner_user_id
  FROM hub_sessions
  WHERE sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12'
  UNION
  SELECT owner_user_id
  FROM hub_sessions
  WHERE sid IN (
    'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
    'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
    'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
    'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
    'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
  )
)
GROUP BY s.owner_user_id;

-- Resolve the reviewed Paperboy tenant by the Team-owned avatar Session first,
-- falling back to the oldest live Team named Paperboy for fresh/staging copies.
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
  'project_team_' || t.id || '_paperboy',
  NULL,
  t.id,
  'paperboy',
  'Paperboy',
  'Paperboy is the Team workspace for product and infrastructure work that does not belong to a more specific Project.',
  NULL,
  t.created_by_user_id,
  t.created_at,
  MAX(t.updated_at, COALESCE((SELECT MAX(updated_at) FROM hub_sessions WHERE team_id = t.id), t.updated_at)),
  NULL
FROM teams t
WHERE t.id = COALESCE(
  (
    SELECT team_id
    FROM hub_sessions
    WHERE
      sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' AND
      team_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT id
    FROM teams
    WHERE lower(name) = 'paperboy'
    ORDER BY
      CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
      created_at,
      id
    LIMIT 1
  )
);

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
  'project_team_' || t.id || '_avatar-generator',
  NULL,
  t.id,
  'avatar-generator',
  'Avatar Generator',
  'Paperboy''s avatar generator turns eight fixed retro-futurist illustrations into reproducible default avatars by varying color palettes without redrawing their structure.',
  NULL,
  t.created_by_user_id,
  t.created_at,
  MAX(t.updated_at, COALESCE((SELECT MAX(updated_at) FROM hub_sessions WHERE team_id = t.id), t.updated_at)),
  NULL
FROM teams t
WHERE t.id = COALESCE(
  (
    SELECT team_id
    FROM hub_sessions
    WHERE
      sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' AND
      team_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT id
    FROM teams
    WHERE lower(name) = 'paperboy'
    ORDER BY
      CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
      created_at,
      id
    LIMIT 1
  )
);

-- Preserve already-retired owner state when upgrading a database whose user
-- deletion or Team archival happened before Projects existed.
UPDATE projects
SET
  archived_at = (
    SELECT u.deleted_at
    FROM users u
    WHERE u.id = projects.owner_user_id
  ),
  updated_at = MAX(
    updated_at,
    (
      SELECT u.deleted_at
      FROM users u
      WHERE u.id = projects.owner_user_id
    )
  )
WHERE
  owner_user_id IS NOT NULL AND
  EXISTS (
    SELECT 1
    FROM users u
    WHERE u.id = projects.owner_user_id AND u.deleted_at IS NOT NULL
  );

UPDATE projects
SET
  archived_at = (
    SELECT t.archived_at
    FROM teams t
    WHERE t.id = projects.owner_team_id
  ),
  updated_at = MAX(
    updated_at,
    (
      SELECT t.archived_at
      FROM teams t
      WHERE t.id = projects.owner_team_id
    )
  )
WHERE
  owner_team_id IS NOT NULL AND
  EXISTS (
    SELECT 1
    FROM teams t
    WHERE t.id = projects.owner_team_id AND t.archived_at IS NOT NULL
  );

-- Start every row at its tenant's deterministic fallback, then apply the
-- reviewed business grouping from broad to specific.
UPDATE hub_sessions
SET project_id = CASE
  WHEN team_id IS NULL
    THEN 'project_default_user_' || owner_user_id
  ELSE 'project_default_team_' || team_id
END;

UPDATE hub_sessions
SET project_id = 'project_user_' || owner_user_id || '_spool'
WHERE
  team_id IS NULL AND
  owner_user_id IN (
    SELECT owner_user_id
    FROM hub_sessions
    WHERE sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12'
  );

UPDATE hub_sessions
SET project_id = 'project_user_' || owner_user_id || '_spool'
WHERE
  team_id IS NULL AND
  sid IN (
    'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
    'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
    'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
    'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
    'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
  );

UPDATE hub_sessions
SET project_id = 'project_user_' || owner_user_id || '_react-vapor'
WHERE
  team_id IS NULL AND
  sid IN (
    'claude_52d60289-1a34-41ff-bf63-a77593a53d8a',
    'claude_9cea282a-d9cf-434d-83f4-633cca085faf'
  );

UPDATE hub_sessions
SET project_id = 'project_team_' || team_id || '_paperboy'
WHERE team_id = COALESCE(
  (
    SELECT team_id
    FROM hub_sessions
    WHERE
      sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' AND
      team_id IS NOT NULL
    LIMIT 1
  ),
  (
    SELECT id
    FROM teams
    WHERE lower(name) = 'paperboy'
    ORDER BY
      CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
      created_at,
      id
    LIMIT 1
  )
);

UPDATE hub_sessions
SET project_id = 'project_team_' || team_id || '_avatar-generator'
WHERE
  team_id = COALESCE(
    (
      SELECT team_id
      FROM hub_sessions
      WHERE
        sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' AND
        team_id IS NOT NULL
      LIMIT 1
    ),
    (
      SELECT id
      FROM teams
      WHERE lower(name) = 'paperboy'
      ORDER BY
        CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
        created_at,
        id
      LIMIT 1
    )
  ) AND
  (
    sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' OR
    EXISTS (
      SELECT 1
      FROM hub_session_discovery d
      WHERE
        d.sid = hub_sessions.sid AND
        (
          lower(COALESCE(d.title, '')) LIKE '%avatar%' OR
          lower(COALESCE(d.title, '')) LIKE '%summary%' OR
          lower(COALESCE(d.title, '')) LIKE '%title%' OR
          COALESCE(d.title, '') LIKE '%头像%' OR
          COALESCE(d.title, '') LIKE '%摘要%' OR
          COALESCE(d.title, '') LIKE '%标题%'
        )
    )
  );

-- Controlled route seeds. They deliberately bypass the public reserved-word
-- validator, but still obey permanent global route ownership.
--
-- The seed phase is replay-safe and deliberately fail-closed:
--   * an already-active exact claim is retained without mutation;
--   * a different active handle owned by the intended owner is released as a
--     permanent tombstone before the controlled handle is claimed;
--   * an exact handle already claimed by another owner, or already released by
--     any owner, aborts the migration instead of silently choosing a new URL.
CREATE TABLE controlled_handle_seeds_0014 (
  handle TEXT PRIMARY KEY COLLATE NOCASE,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  claimed_at INTEGER NOT NULL,
  CHECK (
    (user_id IS NOT NULL AND team_id IS NULL) OR
    (user_id IS NULL AND team_id IS NOT NULL)
  )
);

INSERT INTO controlled_handle_seeds_0014 (handle, user_id, team_id, claimed_at)
SELECT
  'evan',
  u.id,
  NULL,
  COALESCE(
    (SELECT MIN(s.created_at) FROM hub_sessions s WHERE s.owner_user_id = u.id),
    u.created_at
  )
FROM users u
WHERE
  u.deleted_at IS NULL AND
  u.id = (
    SELECT s.owner_user_id
    FROM hub_sessions s
    WHERE
      s.team_id IS NULL AND
      s.sid IN (
        'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866',
        'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595',
        'codex_019f89dc-54e9-7eb1-97cc-753269f594cb',
        'codex_019f8a35-c2dd-7b72-a754-839cf3efae86',
        'codex_019f8e14-8152-7412-98c7-ab55a1e32de3'
      )
    ORDER BY
      CASE s.sid
        WHEN 'codex_019f88f4-7675-7fb1-b7b1-c9fb283fe866' THEN 0
        WHEN 'codex_019f8919-cd74-7ef1-8a2c-b26bef86e595' THEN 1
        WHEN 'codex_019f89dc-54e9-7eb1-97cc-753269f594cb' THEN 2
        WHEN 'codex_019f8a35-c2dd-7b72-a754-839cf3efae86' THEN 3
        ELSE 4
      END
    LIMIT 1
  );

INSERT INTO controlled_handle_seeds_0014 (handle, user_id, team_id, claimed_at)
SELECT
  'xinyao',
  u.id,
  NULL,
  COALESCE(
    (SELECT MIN(s.created_at) FROM hub_sessions s WHERE s.owner_user_id = u.id),
    u.created_at
  )
FROM users u
WHERE
  u.deleted_at IS NULL AND
  u.id = (
    SELECT s.owner_user_id
    FROM hub_sessions s
    WHERE
      s.team_id IS NULL AND
      s.sid IN (
        'claude_52d60289-1a34-41ff-bf63-a77593a53d8a',
        'claude_9cea282a-d9cf-434d-83f4-633cca085faf'
      )
    ORDER BY s.sid
    LIMIT 1
  );

INSERT INTO controlled_handle_seeds_0014 (handle, user_id, team_id, claimed_at)
SELECT
  'vivian-kong',
  u.id,
  NULL,
  COALESCE(
    (SELECT MIN(s.created_at) FROM hub_sessions s WHERE s.owner_user_id = u.id),
    u.created_at
  )
FROM users u
WHERE
  u.deleted_at IS NULL AND
  u.id = (
    SELECT s.owner_user_id
    FROM hub_sessions s
    WHERE s.sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12'
    LIMIT 1
  );

INSERT INTO controlled_handle_seeds_0014 (handle, user_id, team_id, claimed_at)
SELECT
  'paperboy',
  NULL,
  t.id,
  t.created_at
FROM teams t
WHERE
  t.archived_at IS NULL AND
  t.id = COALESCE(
    (
      SELECT team_id
      FROM hub_sessions
      WHERE
        sid = 'codex_019f845e-2b39-7862-8fb6-287f0af11d12' AND
        team_id IS NOT NULL
      LIMIT 1
    ),
    (
      SELECT id
      FROM teams
      WHERE lower(name) = 'paperboy'
      ORDER BY
        CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END,
        created_at,
        id
      LIMIT 1
    )
  );

CREATE TABLE controlled_handle_seed_guard_0014 (
  ok INTEGER NOT NULL CONSTRAINT controlled_handle_seed_conflict CHECK (ok = 1)
);
INSERT INTO controlled_handle_seed_guard_0014 (ok)
SELECT CASE
  WHEN
    -- One owner cannot be assigned two controlled routes.
    EXISTS (
      SELECT 1
      FROM controlled_handle_seeds_0014 first_seed
      JOIN controlled_handle_seeds_0014 second_seed
        ON first_seed.handle <> second_seed.handle
      WHERE
        (
          first_seed.user_id IS NOT NULL AND
          first_seed.user_id = second_seed.user_id
        ) OR (
          first_seed.team_id IS NOT NULL AND
          first_seed.team_id = second_seed.team_id
        )
    ) OR
    -- A released exact route is a tombstone, and an exact route belonging to
    -- another owner must never be reassigned.
    EXISTS (
      SELECT 1
      FROM controlled_handle_seeds_0014 seed
      JOIN handles existing ON existing.handle = seed.handle
      WHERE NOT (
        existing.released_at IS NULL AND
        (
          (
            seed.user_id IS NOT NULL AND
            existing.user_id = seed.user_id AND
            existing.team_id IS NULL
          ) OR (
            seed.team_id IS NOT NULL AND
            existing.user_id IS NULL AND
            existing.team_id = seed.team_id
          )
        )
      )
    )
  THEN 0
  ELSE 1
END;
DROP TABLE controlled_handle_seed_guard_0014;

-- Migrate an intended owner's previous active route to the controlled route.
-- The previous row remains queryable forever as a released tombstone.
UPDATE handles
SET released_at = MAX(
  handles.claimed_at,
  (
    SELECT seed.claimed_at
    FROM controlled_handle_seeds_0014 seed
    WHERE
      (
        seed.user_id IS NOT NULL AND
        seed.user_id = handles.user_id AND
        handles.team_id IS NULL
      ) OR (
        seed.team_id IS NOT NULL AND
        seed.team_id = handles.team_id AND
        handles.user_id IS NULL
      )
  )
)
WHERE
  handles.released_at IS NULL AND
  EXISTS (
    SELECT 1
    FROM controlled_handle_seeds_0014 seed
    WHERE
      seed.handle <> handles.handle AND
      (
        (
          seed.user_id IS NOT NULL AND
          seed.user_id = handles.user_id AND
          handles.team_id IS NULL
        ) OR (
          seed.team_id IS NOT NULL AND
          seed.team_id = handles.team_id AND
          handles.user_id IS NULL
        )
      )
  );

INSERT INTO handles (handle, user_id, team_id, claimed_at, released_at)
SELECT seed.handle, seed.user_id, seed.team_id, seed.claimed_at, NULL
FROM controlled_handle_seeds_0014 seed
WHERE NOT EXISTS (
  SELECT 1
  FROM handles existing
  WHERE
    existing.handle = seed.handle AND
    existing.released_at IS NULL AND
    (
      (
        seed.user_id IS NOT NULL AND
        existing.user_id = seed.user_id AND
        existing.team_id IS NULL
      ) OR (
        seed.team_id IS NOT NULL AND
        existing.user_id IS NULL AND
        existing.team_id = seed.team_id
      )
    )
);

CREATE TABLE controlled_handle_seed_post_guard_0014 (
  ok INTEGER NOT NULL CONSTRAINT controlled_handle_seed_postcondition CHECK (ok = 1)
);
INSERT INTO controlled_handle_seed_post_guard_0014 (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM controlled_handle_seeds_0014 seed
    WHERE
      NOT EXISTS (
        SELECT 1
        FROM handles exact
        WHERE
          exact.handle = seed.handle AND
          exact.released_at IS NULL AND
          (
            (
              seed.user_id IS NOT NULL AND
              exact.user_id = seed.user_id AND
              exact.team_id IS NULL
            ) OR (
              seed.team_id IS NOT NULL AND
              exact.user_id IS NULL AND
              exact.team_id = seed.team_id
            )
          )
      ) OR
      EXISTS (
        SELECT 1
        FROM handles other
        WHERE
          other.released_at IS NULL AND
          other.handle <> seed.handle AND
          (
            (
              seed.user_id IS NOT NULL AND
              other.user_id = seed.user_id AND
              other.team_id IS NULL
            ) OR (
              seed.team_id IS NOT NULL AND
              other.user_id IS NULL AND
              other.team_id = seed.team_id
            )
          )
      )
  )
  THEN 0
  ELSE 1
END;
DROP TABLE controlled_handle_seed_post_guard_0014;
DROP TABLE controlled_handle_seeds_0014;

-- Every active Team, plus every remaining user who owns an active Project,
-- receives a deterministic route: a normalized readable name plus an owner-id
-- suffix. Teams need a handle before their first Project/Session is created.
-- The common suffix is eight stable id characters; an existing/tombstoned
-- collision or a same-run candidate collision expands it to sixteen stable
-- characters. The final UNIQUE constraints fail closed if even the expanded
-- candidate collides.
CREATE TABLE project_handle_candidates_0014 (
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('user', 'team')),
  owner_id TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT,
  base TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (owner_kind, owner_id),
  CHECK (
    (user_id IS NOT NULL AND team_id IS NULL) OR
    (user_id IS NULL AND team_id IS NOT NULL)
  )
);

INSERT INTO project_handle_candidates_0014
  (owner_kind, owner_id, user_id, team_id, base, claimed_at)
SELECT DISTINCT
  'user',
  u.id,
  u.id,
  NULL,
  COALESCE(
    NULLIF(trim(u.display_name), ''),
    NULLIF(trim(u.name), ''),
    'user'
  ),
  (SELECT MIN(candidate.created_at) FROM projects candidate WHERE candidate.owner_user_id = u.id)
FROM projects p
JOIN users u ON u.id = p.owner_user_id
WHERE
  p.owner_user_id IS NOT NULL AND
  p.owner_team_id IS NULL AND
  p.archived_at IS NULL AND
  u.deleted_at IS NULL AND
  NOT EXISTS (
    SELECT 1
    FROM handles h
    WHERE h.user_id = u.id AND h.released_at IS NULL
  );

INSERT INTO project_handle_candidates_0014
  (owner_kind, owner_id, user_id, team_id, base, claimed_at)
SELECT DISTINCT
  'team',
  t.id,
  NULL,
  t.id,
  COALESCE(NULLIF(trim(t.name), ''), 'team'),
  t.created_at
FROM teams t
WHERE
  t.archived_at IS NULL AND
  NOT EXISTS (
    SELECT 1
    FROM handles h
    WHERE h.team_id = t.id AND h.released_at IS NULL
  );

UPDATE project_handle_candidates_0014
SET base = lower(trim(base));

UPDATE project_handle_candidates_0014
SET base = replace(replace(replace(replace(replace(base, ' ', '-'), '.', '-'), '+', '-'), '/', '-'), '@', '-');

UPDATE project_handle_candidates_0014
SET base = trim(replace(replace(replace(base, '--', '-'), '--', '-'), '--', '-'), '-_');

UPDATE project_handle_candidates_0014
SET base = CASE
  WHEN
    length(base) = 0 OR
    substr(base, 1, 1) NOT GLOB '[a-z]' OR
    base GLOB '*[^a-z0-9_-]*'
  THEN CASE owner_kind WHEN 'user' THEN 'user' ELSE 'team' END
  ELSE base
END;

WITH encoded AS (
  SELECT
    candidate.*,
    CASE
      WHEN
        length(candidate.owner_id) >= 8 AND
        lower(substr(candidate.owner_id, 1, 8)) NOT GLOB '*[^a-z0-9_-]*'
      THEN lower(substr(candidate.owner_id, 1, 8))
      ELSE lower(substr(hex(candidate.owner_id) || '00000000', 1, 8))
    END AS short_suffix,
    CASE
      WHEN
        length(candidate.owner_id) >= 16 AND
        lower(substr(candidate.owner_id, 1, 8) || substr(candidate.owner_id, -8)) NOT GLOB
          '*[^a-z0-9_-]*'
      THEN lower(substr(candidate.owner_id, 1, 8) || substr(candidate.owner_id, -8))
      ELSE lower(
        substr(hex(candidate.owner_id) || '00000000', 1, 8) ||
        substr('00000000' || hex(candidate.owner_id), -8)
      )
    END AS long_suffix
  FROM project_handle_candidates_0014 candidate
),
named AS (
  SELECT
    encoded.*,
    substr(encoded.base, 1, 22) || '-' || encoded.short_suffix AS short_handle,
    substr(encoded.base, 1, 14) || '-' || encoded.long_suffix AS long_handle
  FROM encoded
),
resolved AS (
  SELECT
    named.*,
    CASE
      WHEN
        EXISTS (SELECT 1 FROM handles existing WHERE existing.handle = named.short_handle) OR
        (SELECT COUNT(*) FROM named peer WHERE peer.short_handle = named.short_handle) > 1
      THEN named.long_handle
      ELSE named.short_handle
    END AS handle
  FROM named
)
INSERT INTO handles (handle, user_id, team_id, claimed_at, released_at)
SELECT handle, user_id, team_id, claimed_at, NULL
FROM resolved
ORDER BY owner_kind, owner_id;

DROP TABLE project_handle_candidates_0014;

CREATE TABLE project_handle_guard_0014 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO project_handle_guard_0014 (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM projects p
    WHERE
      p.archived_at IS NULL AND
      (
        (
          p.owner_user_id IS NOT NULL AND
          NOT EXISTS (
            SELECT 1
            FROM handles h
            WHERE h.user_id = p.owner_user_id AND h.released_at IS NULL
          )
        ) OR (
          p.owner_team_id IS NOT NULL AND
          NOT EXISTS (
            SELECT 1
            FROM handles h
            WHERE h.team_id = p.owner_team_id AND h.released_at IS NULL
          )
        )
      )
  )
  THEN 0
  ELSE 1
END;
DROP TABLE project_handle_guard_0014;

CREATE INDEX hub_sessions_owner_project_updated
  ON hub_sessions(owner_user_id, project_id, updated_at DESC, sid);
CREATE INDEX hub_sessions_team_project_updated
  ON hub_sessions(team_id, project_id, updated_at DESC, sid)
  WHERE team_id IS NOT NULL;

-- SQLite cannot strengthen an added column to NOT NULL without rebuilding the
-- parent of several live foreign keys. The migration backfills every row and
-- these triggers provide the same invariant for all future writes while
-- retaining the original hub_sessions primary-key identity.
--
-- Production applies D1 migrations before it replaces the Pages deployment.
-- During that rolling window the old Hub writer still omits project_id. Repair
-- that exact legacy shape inside the same statement instead of breaking every
-- share until the new Worker is live (or indefinitely if its deploy fails).
CREATE TRIGGER hub_sessions_project_legacy_insert
AFTER INSERT ON hub_sessions
WHEN NEW.project_id IS NULL
BEGIN
  -- Users created by the old deployment after this migration were not present
  -- in the handle backfill. Give a first-time Personal sharer a deterministic
  -- route before creating their fallback Project. Current user ids are 16
  -- lowercase hex characters, so both candidates satisfy the handle grammar.
  INSERT OR IGNORE INTO handles (handle, user_id, team_id, claimed_at, released_at)
  SELECT
    'user-' || lower(NEW.owner_user_id),
    NEW.owner_user_id,
    NULL,
    NEW.created_at,
    NULL
  FROM users owner
  WHERE
    NEW.team_id IS NULL AND
    owner.id = NEW.owner_user_id AND
    owner.deleted_at IS NULL AND
    NOT EXISTS (
      SELECT 1 FROM handles handle
      WHERE handle.user_id = NEW.owner_user_id AND handle.released_at IS NULL
    );

  INSERT OR IGNORE INTO handles (handle, user_id, team_id, claimed_at, released_at)
  SELECT
    'u-' || lower(NEW.owner_user_id),
    NEW.owner_user_id,
    NULL,
    NEW.created_at,
    NULL
  FROM users owner
  WHERE
    NEW.team_id IS NULL AND
    owner.id = NEW.owner_user_id AND
    owner.deleted_at IS NULL AND
    NOT EXISTS (
      SELECT 1 FROM handles handle
      WHERE handle.user_id = NEW.owner_user_id AND handle.released_at IS NULL
    );

  SELECT CASE
    WHEN
      NEW.team_id IS NULL AND
      NOT EXISTS (
        SELECT 1 FROM handles handle
        WHERE handle.user_id = NEW.owner_user_id AND handle.released_at IS NULL
      )
    THEN RAISE(ABORT, 'hub session project owner handle is required')
  END;

  INSERT OR IGNORE INTO projects (
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
    'project_default_user_' || NEW.owner_user_id,
    NEW.owner_user_id,
    NULL,
    'sessions',
    'Sessions',
    'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
    NULL,
    NEW.owner_user_id,
    NEW.created_at,
    NEW.updated_at,
    NULL
  FROM users owner
  WHERE
    NEW.team_id IS NULL AND
    owner.id = NEW.owner_user_id AND
    owner.deleted_at IS NULL;

  INSERT OR IGNORE INTO projects (
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
    'project_default_team_' || NEW.team_id,
    NULL,
    NEW.team_id,
    'sessions',
    'Sessions',
    'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
    NULL,
    team.created_by_user_id,
    NEW.created_at,
    NEW.updated_at,
    NULL
  FROM teams team
  WHERE
    NEW.team_id IS NOT NULL AND
    team.id = NEW.team_id AND
    team.archived_at IS NULL;

  UPDATE hub_sessions
  SET project_id = CASE
    WHEN NEW.team_id IS NULL THEN (
      SELECT project.id
      FROM projects project
      WHERE
        project.owner_user_id = NEW.owner_user_id AND
        project.owner_team_id IS NULL AND
        project.archived_at IS NULL AND
        (
          project.id = 'project_default_user_' || NEW.owner_user_id OR
          project.slug = 'sessions'
        )
      ORDER BY
        CASE
          WHEN project.id = 'project_default_user_' || NEW.owner_user_id THEN 0
          ELSE 1
        END,
        project.created_at,
        project.id
      LIMIT 1
    )
    ELSE (
      SELECT project.id
      FROM projects project
      WHERE
        project.owner_user_id IS NULL AND
        project.owner_team_id = NEW.team_id AND
        project.archived_at IS NULL AND
        (
          project.id = 'project_default_team_' || NEW.team_id OR
          project.slug = 'sessions'
        )
      ORDER BY
        CASE
          WHEN project.id = 'project_default_team_' || NEW.team_id THEN 0
          ELSE 1
        END,
        project.created_at,
        project.id
      LIMIT 1
    )
  END
  WHERE sid = NEW.sid AND project_id IS NULL;
END;

CREATE TRIGGER hub_sessions_project_required_update
BEFORE UPDATE OF project_id ON hub_sessions
WHEN NEW.project_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'hub session project is required');
END;

CREATE TRIGGER hub_sessions_project_tenant_insert
BEFORE INSERT ON hub_sessions
WHEN NEW.project_id IS NOT NULL AND NOT EXISTS (
  SELECT 1
  FROM projects p
  WHERE
    p.id = NEW.project_id AND
    p.archived_at IS NULL AND
    (
      (
        p.owner_user_id = NEW.owner_user_id AND
        p.owner_team_id IS NULL AND
        NEW.team_id IS NULL
      ) OR (
        p.owner_user_id IS NULL AND
        p.owner_team_id = NEW.team_id AND
        NEW.team_id IS NOT NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'hub session project tenant mismatch');
END;

CREATE TRIGGER hub_sessions_project_tenant_update
BEFORE UPDATE OF project_id, owner_user_id, team_id ON hub_sessions
WHEN
  NEW.project_id IS NOT NULL AND
  NOT (
    OLD.team_id IS NULL AND
    NEW.team_id IS NOT NULL AND
    NEW.owner_user_id IS OLD.owner_user_id AND
    NEW.project_id IS OLD.project_id
  ) AND
  NOT EXISTS (
  SELECT 1
  FROM projects p
  WHERE
    p.id = NEW.project_id AND
    p.archived_at IS NULL AND
    (
      (
        p.owner_user_id = NEW.owner_user_id AND
        p.owner_team_id IS NULL AND
        NEW.team_id IS NULL
      ) OR (
        p.owner_user_id IS NULL AND
        p.owner_team_id = NEW.team_id AND
        NEW.team_id IS NOT NULL
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'hub session project tenant mismatch');
END;

-- The pre-0014 writer transfers a Personal Session by changing team_id while
-- leaving every unknown column untouched. Permit only that precise transition,
-- then switch the row to the target Team's fallback Project atomically.
CREATE TRIGGER hub_sessions_project_legacy_team_transfer
AFTER UPDATE OF team_id ON hub_sessions
WHEN
  OLD.team_id IS NULL AND
  NEW.team_id IS NOT NULL AND
  NEW.owner_user_id IS OLD.owner_user_id AND
  NEW.project_id IS OLD.project_id
BEGIN
  INSERT OR IGNORE INTO projects (
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
    'project_default_team_' || NEW.team_id,
    NULL,
    NEW.team_id,
    'sessions',
    'Sessions',
    'Sessions from older clients or work without a specific Project are collected here so every Session keeps a stable home.',
    NULL,
    team.created_by_user_id,
    NEW.created_at,
    NEW.updated_at,
    NULL
  FROM teams team
  WHERE
    team.id = NEW.team_id AND
    team.archived_at IS NULL;

  UPDATE hub_sessions
  SET project_id = (
    SELECT project.id
    FROM projects project
    WHERE
      project.owner_user_id IS NULL AND
      project.owner_team_id = NEW.team_id AND
      project.archived_at IS NULL AND
      (
        project.id = 'project_default_team_' || NEW.team_id OR
        project.slug = 'sessions'
      )
    ORDER BY
      CASE
        WHEN project.id = 'project_default_team_' || NEW.team_id THEN 0
        ELSE 1
      END,
      project.created_at,
      project.id
    LIMIT 1
  )
  WHERE sid = NEW.sid AND project_id IS NEW.project_id;
END;

-- Turn an incomplete backfill into a migration failure instead of shipping a
-- nullable or cross-tenant row. This temporary guard is dropped immediately.
CREATE TABLE project_backfill_guard_0014 (
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO project_backfill_guard_0014 (ok)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM hub_sessions s
    LEFT JOIN projects p ON p.id = s.project_id
    WHERE
      s.project_id IS NULL OR
      p.id IS NULL OR
      (
        s.team_id IS NULL AND
        NOT (
          p.owner_user_id = s.owner_user_id AND
          p.owner_team_id IS NULL
        )
      ) OR
      (
        s.team_id IS NOT NULL AND
        NOT (
          p.owner_user_id IS NULL AND
          p.owner_team_id = s.team_id
        )
      )
  )
  THEN 0
  ELSE 1
END;
DROP TABLE project_backfill_guard_0014;

-- Every active Team has received a handle above. Capture it on old creation
-- receipts, then freeze handle intent once chosen. Old Pages deployments omit
-- requested_handle, so NULL must remain a legal rolling-deploy input.
UPDATE team_creation_requests
SET requested_handle = (
  SELECT h.handle
  FROM handles h
  WHERE h.team_id = team_creation_requests.team_id
    AND h.released_at IS NULL
  LIMIT 1
)
WHERE
  requested_handle IS NULL AND
  EXISTS (
    SELECT 1
    FROM handles h
    WHERE h.team_id = team_creation_requests.team_id
      AND h.released_at IS NULL
  );

CREATE TRIGGER team_creation_requests_handle_immutable
BEFORE UPDATE OF requested_handle ON team_creation_requests
WHEN
  OLD.requested_handle IS NOT NULL AND
  NEW.requested_handle IS NOT OLD.requested_handle
BEGIN
  SELECT RAISE(ABORT, 'team creation handle is immutable');
END;

-- Complete an in-flight Team created by a pre-0014 Pages deployment with a
-- stable emergency handle. Normal 0014+ creation already carries an explicit
-- requested_handle and bypasses this compatibility trigger. The second
-- candidate is only a collision fallback; both are derived from the random
-- Team id and remain within the public handle grammar.
CREATE TRIGGER teams_legacy_creation_handle
AFTER INSERT ON teams
WHEN EXISTS (
  SELECT 1
  FROM team_creation_requests request
  WHERE request.team_id = NEW.id AND request.requested_handle IS NULL
)
BEGIN
  INSERT OR IGNORE INTO handles (handle, user_id, team_id, claimed_at, released_at)
  VALUES (
    'team-' || lower(substr(NEW.id, -27)),
    NULL,
    NEW.id,
    NEW.created_at,
    NULL
  );

  INSERT OR IGNORE INTO handles (handle, user_id, team_id, claimed_at, released_at)
  SELECT
    't-' || lower(substr(NEW.id, -30)),
    NULL,
    NEW.id,
    NEW.created_at,
    NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM handles handle
    WHERE handle.team_id = NEW.id AND handle.released_at IS NULL
  );

  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM handles handle
      WHERE handle.team_id = NEW.id AND handle.released_at IS NULL
    )
    THEN RAISE(ABORT, 'legacy Team handle allocation failed')
  END;

  UPDATE team_creation_requests
  SET
    requested_handle = (
      SELECT handle.handle
      FROM handles handle
      WHERE handle.team_id = NEW.id AND handle.released_at IS NULL
      LIMIT 1
    ),
    updated_at = MAX(updated_at, NEW.created_at)
  WHERE
    team_id = NEW.id AND
    requested_handle IS NULL AND
    EXISTS (
      SELECT 1 FROM handles handle
      WHERE handle.team_id = NEW.id AND handle.released_at IS NULL
    );
END;

-- 0007_team_workspaces.sql
--
-- Team workspaces are the tenancy and authorization boundary for private
-- collaboration. WorkOS Organizations carry the hosted organization,
-- membership, and invitation transport; D1 remains the runtime source of
-- truth for roles and access decisions.

CREATE TABLE teams (
  id TEXT PRIMARY KEY,
  workos_organization_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deletion_pending_until INTEGER,
  archived_at INTEGER
);
CREATE INDEX teams_creator ON teams(created_by_user_id, created_at DESC);

CREATE TABLE team_memberships (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  workos_membership_id TEXT UNIQUE,
  joined_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_memberships_user ON team_memberships(user_id, team_id);
CREATE INDEX team_memberships_team_role ON team_memberships(team_id, role, user_id);

-- A local removal must not be undone by an eventually-consistent or stale
-- WorkOS membership returned during an ordinary sign-in. A later explicit
-- invitation may supersede the block (the sync path compares timestamps).
CREATE TABLE team_membership_blocks (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  workos_user_id TEXT,
  blocked_at INTEGER NOT NULL,
  blocked_by_user_id TEXT REFERENCES users(id),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_membership_blocks_user ON team_membership_blocks(user_id, team_id);
CREATE UNIQUE INDEX team_membership_blocks_workos_user
  ON team_membership_blocks(team_id, workos_user_id)
  WHERE workos_user_id IS NOT NULL;

-- WorkOS sends and accepts the invitation. This row is a bounded local
-- projection carrying the role Spool should grant after acceptance. WorkOS
-- always receives role_slug='member'; owner/admin are Spool-local roles.
CREATE TABLE team_invitations (
  id TEXT PRIMARY KEY,
  workos_invitation_id TEXT NOT NULL UNIQUE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  desired_role TEXT NOT NULL CHECK (desired_role IN ('admin','member')),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','revoked','expired')),
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  accepted_workos_user_id TEXT,
  expires_at INTEGER,
  accepted_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX team_invitations_team_created
  ON team_invitations(team_id, created_at DESC);
CREATE INDEX team_invitations_email
  ON team_invitations(email, team_id, created_at DESC);
CREATE UNIQUE INDEX team_invitations_pending_email
  ON team_invitations(team_id, email)
  WHERE status = 'pending';

-- Team-owned Hub objects have a tenant-scoped index. A synchronous ownership
-- transfer may initially alias an immutable personal pack; the account
-- deletion sweep re-homes those mappings into hub/team-packs/<team>/ before
-- erasing the personal prefix. Authorization is always driven by this table,
-- never by the physical key prefix.
CREATE TABLE hub_team_objects (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  oid TEXT NOT NULL,
  size INTEGER NOT NULL,
  pack_key TEXT NOT NULL,
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, oid)
);
CREATE INDEX hub_team_objects_pack ON hub_team_objects(team_id, pack_key);
CREATE INDEX hub_team_objects_physical_pack ON hub_team_objects(pack_key, team_id);

-- Keep the existing hub_sessions.visibility CHECK intact. A future Team-only
-- head uses visibility='private' together with a non-null team_id; existing
-- rows remain personal/public-by-link with team_id=NULL.
ALTER TABLE hub_sessions ADD COLUMN team_id TEXT REFERENCES teams(id) ON DELETE RESTRICT;
CREATE INDEX hub_sessions_team_updated
  ON hub_sessions(team_id, updated_at DESC)
  WHERE team_id IS NOT NULL;

-- Team actions use audit_log.target_id=team_id. This index keeps a tenant's
-- security history queryable without changing the stable audit insert shape.
CREATE INDEX audit_target_ts ON audit_log(target_id, ts DESC);

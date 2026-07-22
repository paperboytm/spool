-- 0009_workos_durability.sql
--
-- WorkOS is the hosted organization transport, while D1 remains the runtime
-- authorization source of truth. These tables make both directions durable:
-- signed webhook deliveries revoke local access immediately, and local-first
-- removals retry upstream cleanup until WorkOS reaches the same state.

ALTER TABLE team_memberships ADD COLUMN workos_updated_at INTEGER;

CREATE TABLE workos_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_created_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  processed_at INTEGER
);
CREATE INDEX workos_webhook_events_received
  ON workos_webhook_events(received_at);

CREATE TABLE workos_cleanup_outbox (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (
    operation IN ('membership.delete','organization.delete','invitation.revoke')
  ),
  resource_id TEXT NOT NULL,
  team_id TEXT,
  user_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (operation, resource_id)
);
CREATE INDEX workos_cleanup_outbox_due
  ON workos_cleanup_outbox(next_attempt_at, created_at);

-- Exact upstream tombstones close the callback/webhook race where a sign-in
-- has already fetched an active membership but its local projection has not
-- committed yet. Membership ids are never broadened to a user-level Team
-- block, so a later legitimate invitation with a new membership id can join.
CREATE TABLE workos_membership_denials (
  organization_id TEXT NOT NULL,
  membership_id TEXT NOT NULL,
  workos_user_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('deleted','inactive')),
  workos_updated_at INTEGER,
  team_id TEXT,
  user_id TEXT,
  previous_role TEXT CHECK (previous_role IS NULL OR previous_role IN ('owner','admin','member')),
  denied_at INTEGER NOT NULL,
  event_id TEXT,
  PRIMARY KEY (organization_id, membership_id)
);
CREATE INDEX workos_membership_denials_user
  ON workos_membership_denials(workos_user_id, denied_at);

-- A WorkOS user.deleted event has no Organization membership list. Its stable
-- upstream user id is therefore the exact authorization tombstone needed to
-- stop an already-fetched callback snapshot from recreating any Team grant.
CREATE TABLE workos_user_denials (
  workos_user_id TEXT PRIMARY KEY,
  denied_at INTEGER NOT NULL,
  event_id TEXT
);

-- A browser-generated operation key survives double-clicks, lost responses,
-- and retries. team_id doubles as WorkOS's unique external_id, so a create
-- response lost after upstream commit can be recovered without a duplicate.
CREATE TABLE team_creation_requests (
  user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  team_id TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  workos_organization_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, idempotency_key)
);
CREATE INDEX team_creation_requests_updated
  ON team_creation_requests(updated_at);

-- Invitation delivery has the same cross-system failure window as Team
-- creation: WorkOS may accept and email an invitation before D1 commits its
-- role projection. Persist the browser operation before the network call so a
-- retry reuses one local id and one WorkOS idempotency key instead of creating
-- an invisible invitation that cannot be managed from Spool.
CREATE TABLE team_invitation_requests (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invited_by_user_id TEXT NOT NULL REFERENCES users(id),
  idempotency_key TEXT NOT NULL,
  invitation_id TEXT NOT NULL UNIQUE,
  normalized_email TEXT NOT NULL,
  desired_role TEXT NOT NULL CHECK (desired_role IN ('admin','member')),
  status TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  workos_invitation_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, invited_by_user_id, idempotency_key)
);
CREATE INDEX team_invitation_requests_updated
  ON team_invitation_requests(updated_at);

-- Deletion cancellation and the cron worker must serialize before the first
-- irreversible object-store mutation. A leased processing state lets the
-- worker retry after failure while making a successful cancellation final.
ALTER TABLE deletion_queue ADD COLUMN state TEXT NOT NULL DEFAULT 'pending'
  CHECK (state IN ('pending','processing','cancelled'));
ALTER TABLE deletion_queue ADD COLUMN processing_token TEXT;
ALTER TABLE deletion_queue ADD COLUMN processing_lease_until INTEGER;
UPDATE deletion_queue SET state='cancelled' WHERE cancelled=1;
CREATE INDEX deletion_queue_state_due
  ON deletion_queue(state, scheduled_at, processing_lease_until);

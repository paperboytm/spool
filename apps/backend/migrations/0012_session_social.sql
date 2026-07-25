-- 0012_session_social.sql
-- Public Session stars plus server-issued Resume provenance. Legacy
-- lineage_json remains the display/continuation carrier, but only a one-use
-- grant claimed by a new child head creates a verified fork relation.

CREATE TABLE hub_session_stars (
  sid TEXT NOT NULL REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (sid, user_id)
);

-- The primary key already supports counts and membership checks by Session.
-- This secondary index supports a user's starred Sessions in newest-first
-- order without weakening the one-star-per-user idempotency contract.
CREATE INDEX hub_session_stars_user_created
  ON hub_session_stars(user_id, created_at DESC, sid);

-- A Resume grant is an opaque 256-bit bearer returned once. Only its SHA-256
-- is stored. claimed_child_sid intentionally is not an FK: deleting a child
-- must not make its already-consumed grant reusable.
CREATE TABLE hub_session_resume_grants (
  token_hash TEXT PRIMARY KEY
    CHECK (length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'),
  source_sid TEXT NOT NULL REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  source_root TEXT NOT NULL
    CHECK (length(source_root) = 64 AND source_root NOT GLOB '*[^0-9a-f]*'),
  source_position INTEGER NOT NULL CHECK (source_position >= 1),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  claimed_child_sid TEXT,
  claimed_child_root TEXT,
  claimed_at INTEGER,
  CHECK (
    (claimed_child_sid IS NULL AND claimed_child_root IS NULL AND claimed_at IS NULL)
    OR
    (claimed_child_sid IS NOT NULL AND claimed_child_root IS NOT NULL AND claimed_at IS NOT NULL)
  )
);
CREATE INDEX hub_resume_grants_source_expires
  ON hub_session_resume_grants(source_sid, expires_at DESC);
CREATE INDEX hub_resume_grants_unclaimed_expires
  ON hub_session_resume_grants(expires_at)
  WHERE claimed_child_sid IS NULL;

-- child_sid permits only one verified parent; grant_token_hash permits only
-- one live relation per grant. The grant's durable claimed_* marker keeps that
-- one-use property after a child is deleted and this relation cascades.
CREATE TABLE hub_session_verified_forks (
  child_sid TEXT PRIMARY KEY REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  source_sid TEXT NOT NULL REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  source_root TEXT NOT NULL,
  source_position INTEGER NOT NULL CHECK (source_position >= 1),
  child_root TEXT NOT NULL,
  grant_token_hash TEXT NOT NULL UNIQUE
    REFERENCES hub_session_resume_grants(token_hash),
  verified_at INTEGER NOT NULL,
  CHECK (child_sid <> source_sid)
);
CREATE INDEX hub_verified_forks_source_verified
  ON hub_session_verified_forks(source_sid, verified_at DESC, child_sid);

-- Legacy lineage still drives the visible "continued from" label. It is not
-- evidence for fork counts, but this index keeps those audience-filtered
-- lookups bounded while excluding the legacy NULL majority.
CREATE INDEX hub_discovery_lineage_source_sid
  ON hub_session_discovery(lineage_source_sid, published_at DESC, sid)
  WHERE lineage_source_sid IS NOT NULL;

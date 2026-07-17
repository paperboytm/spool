-- 0003_hub.sql
-- Spool v2 hub: content-addressed session sync (see plans/spool-v2-pr1-scope.md).
--
-- hub_sessions is the head ref: one row per shared session, single-writer
-- (owner). hub_objects locates every uploaded object (records + view
-- objects) inside R2 packs; dedup is deliberately per-user (anti
-- dedup-oracle). api_tokens are long-lived CLI credentials (sha256 stored).

CREATE TABLE hub_sessions (
  sid TEXT PRIMARY KEY,                       -- '<provider>_<provider-session-uuid>'
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  root TEXT NOT NULL,                         -- sequence chain root (hex sha256)
  record_count INTEGER NOT NULL,
  sig TEXT,                                   -- Ed25519 head signature; verification is a follow-up
  card_json TEXT,                             -- workspace card
  note_md TEXT,                               -- author note (share README)
  lineage_json TEXT,                          -- fork origin { sid, position }
  view_oid TEXT,                              -- content-addressed view object
  visibility TEXT NOT NULL DEFAULT 'unlisted' CHECK (visibility IN ('unlisted','private')),
  withdrawn_at INTEGER,                       -- tombstone: body refuses to read, objects retained
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX hub_sessions_owner ON hub_sessions(owner_user_id);

CREATE TABLE hub_objects (
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  oid TEXT NOT NULL,                          -- hex sha256 of canonical bytes
  size INTEGER NOT NULL,
  pack_key TEXT NOT NULL,                     -- R2 key 'hub/packs/<user>/<pack-id>'
  offset INTEGER NOT NULL,
  length INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, oid)
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,                        -- nanoid(16)
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,                   -- sha256 hex of the bearer token
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE UNIQUE INDEX api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX api_tokens_user ON api_tokens(user_id);

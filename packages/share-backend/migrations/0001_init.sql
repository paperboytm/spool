-- 0001_init.sql
-- Initial schema for spool-share-db. Mirrors §7 of the design spec
-- (~/Documents/dev-docs/spool/2026-05-19-spool-share-publish-spec-update.md).
--
-- Tables: users, handles, published_shares, audit_log, reports, deletion_queue.

CREATE TABLE users (
  id TEXT PRIMARY KEY,                        -- nanoid(16)
  google_sub TEXT NOT NULL UNIQUE,            -- Google's `sub` claim
  email TEXT NOT NULL,                        -- may be re-issued by Google over time
  name TEXT,
  avatar_url TEXT,
  created_at INTEGER NOT NULL,
  last_signin_at INTEGER NOT NULL,
  deletion_pending_until INTEGER,             -- null when not pending
  deleted_at INTEGER                          -- soft delete marker
);
CREATE INDEX users_google_sub ON users(google_sub);

CREATE TABLE handles (
  handle TEXT PRIMARY KEY,                    -- lowercase
  user_id TEXT NOT NULL REFERENCES users(id),
  claimed_at INTEGER NOT NULL,
  released_at INTEGER                         -- null when active
);
CREATE INDEX handles_user ON handles(user_id);

CREATE TABLE published_shares (
  id TEXT PRIMARY KEY,                        -- nanoid(21) slug
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('unlisted','profile-listed')),
  expires_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER NOT NULL,
  republished_at INTEGER,
  revoked_at INTEGER,
  -- Local share_drafts.draft_id of the editor draft this share was
  -- published from. Required for v0.5.0+ clients (the renderer relies
  -- on it to drive the editor's "is this draft published?" lookup),
  -- nullable only for forward compatibility with backfills.
  draft_id TEXT,
  -- Client-provided idempotency token (sha256 hex of snapshot +
  -- visibility + expires_at). Lets a renderer retry after a dropped
  -- response without creating a duplicate share. Nullable because the
  -- column is brand new and there's no value to backfill onto legacy
  -- rows; new publishes always supply it.
  client_request_id TEXT
);
CREATE INDEX published_user ON published_shares(user_id);
-- Per-user, per-draft lookup. Republish keeps the same slug + draft_id;
-- a fresh publish after revoke mints a new slug under the same
-- draft_id, so we don't enforce uniqueness here — the renderer
-- prefers the most recent row when the cache surfaces multiples.
CREATE INDEX published_user_draft ON published_shares(user_id, draft_id);
-- Idempotency: at most one LIVE row per (user, client_request_id). A
-- retry with the same token short-circuits to the cached result; a
-- fresh intent (different hash) carries a fresh token and bypasses the
-- guard. The partial predicate excludes legacy rows (NULL token) and
-- revoked tombstones, so a "publish ⇒ revoke ⇒ publish-again with the
-- same content" flow can recycle the token onto a fresh row rather
-- than getting wedged on a stale constraint.
CREATE UNIQUE INDEX published_idemp
  ON published_shares(user_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  ip_hash TEXT NOT NULL,                      -- sha256(ip + daily_salt)
  ua_hash TEXT NOT NULL,
  action TEXT NOT NULL,                       -- 'signin','publish','revoke',...
  target_id TEXT,
  details_json TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX audit_user_ts ON audit_log(user_id, ts);
CREATE INDEX audit_action_ts ON audit_log(action, ts);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_id TEXT NOT NULL,
  reporter_email TEXT,
  reason TEXT NOT NULL,
  details TEXT,
  ip_hash TEXT NOT NULL,
  ts INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolved_at INTEGER
);

CREATE TABLE deletion_queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  scheduled_at INTEGER NOT NULL,
  cancelled INTEGER NOT NULL DEFAULT 0
);

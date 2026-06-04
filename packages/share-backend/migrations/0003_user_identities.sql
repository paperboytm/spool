-- 0003_user_identities.sql
-- Decouple users from their sign-in method. One user can later link
-- multiple identities (Google + GitHub + email + …) — v0.5 only has
-- 'google' registered, but the schema and code paths are ready to
-- accept more without another migration.
--
-- Why now: v0.5 shipped Google-only because that was the fastest path
-- to first sign-in. The single users.google_sub column couldn't
-- represent "Mira signed in with Google AND GitHub", and a future
-- provider would have meant a schema migration plus N column
-- branches in store + tests. Adding this table once removes both.

CREATE TABLE user_identities (
  provider TEXT NOT NULL,                     -- 'google'
  provider_sub TEXT NOT NULL,                 -- provider's stable user id
  user_id TEXT NOT NULL REFERENCES users(id),
  email TEXT,                                 -- email reported at link time
  linked_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_sub)
);
CREATE INDEX user_identities_user ON user_identities(user_id);

-- Backfill from users.google_sub. Tombstoned rows (the deletion
-- worker writes a `[deleted]-<uid>` sentinel into google_sub on hard
-- delete) are skipped — that account no longer has a usable identity.
INSERT INTO user_identities (provider, provider_sub, user_id, email, linked_at)
SELECT 'google', google_sub, id, email, created_at
FROM users
WHERE google_sub NOT LIKE '[deleted]-%';

-- users.google_sub is now redundant. We leave it in place for one
-- release as a safety net (downgrade rollback, audit-log triage) and
-- write a `<provider>:<sub>` composite into it on new sign-ups so the
-- existing UNIQUE constraint keeps preventing duplicate user rows.
-- A future migration drops the column once nothing reads it.

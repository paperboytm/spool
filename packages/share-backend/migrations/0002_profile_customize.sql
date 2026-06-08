-- 0002_profile_customize.sql
--
-- Adds two user-controlled overrides on top of the provider-claim
-- seeds (users.name / users.avatar_url, set from Google at sign-in).
-- Resolution at read time: override-or-fall-back.
--
--   display_name     — user-typed name (1-50 chars). NULL = use Google name.
--   custom_avatar_id — opaque token stored in R2 at avatars/<user>/<id>.
--                      NULL = use Google avatar (if avatar_visible) or
--                      first-letter initials.
--   avatar_visible   — 0 = show first-letter initials even when a
--                      Google avatar exists; 1 = show provider/custom
--                      avatar normally. Lets a privacy-conscious user
--                      hide their Google profile pic without uploading
--                      anything.
--
-- All three are NULL/0-default on existing rows, so first run of v0.6+
-- against a v0.5 DB is a no-op behaviourally.

ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN custom_avatar_id TEXT;
ALTER TABLE users ADD COLUMN avatar_visible INTEGER NOT NULL DEFAULT 1;

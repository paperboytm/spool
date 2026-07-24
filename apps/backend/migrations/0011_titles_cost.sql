-- 0011_titles_cost.sql
-- Bilingual task-outcome titles (parsed from the summary front-matter) and
-- the estimated API cost frozen at head commit from the view's token
-- usage and the vendored pricing snapshot. Legacy rows keep NULLs and render
-- exactly as before; values refresh on the next head commit (re-share).

ALTER TABLE hub_sessions ADD COLUMN cost_usd REAL;
ALTER TABLE hub_sessions ADD COLUMN total_tokens INTEGER;

ALTER TABLE hub_session_discovery ADD COLUMN title_json TEXT;
ALTER TABLE hub_session_discovery ADD COLUMN cost_usd REAL;
ALTER TABLE hub_session_discovery ADD COLUMN total_tokens INTEGER;

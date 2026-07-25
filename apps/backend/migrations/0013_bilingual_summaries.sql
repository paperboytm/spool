-- 0013_bilingual_summaries.sql
-- Public discovery keeps bounded plain-text projections for both authored
-- Summary languages. The canonical bilingual Markdown remains in
-- hub_sessions.note_md; legacy rows keep NULL and fall back to summary_text.

ALTER TABLE hub_session_discovery ADD COLUMN summary_text_zh TEXT;

-- Legacy immutable views can receive a server-derived sparse guidance
-- projection without rewriting their content-addressed view object. The root
-- precondition prevents stale guidance from surviving a later re-share.
CREATE TABLE hub_session_guidance (
  sid TEXT PRIMARY KEY REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  root TEXT NOT NULL,
  guidance_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

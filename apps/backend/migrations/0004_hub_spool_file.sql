-- 0004_hub_spool_file.sql
-- Optional .spool document attached to a hub share (design: the curated
-- publication artifact riding alongside the raw records). Content-addressed
-- like the view object; uploaded through objects/batch.

ALTER TABLE hub_sessions ADD COLUMN spool_file_oid TEXT;

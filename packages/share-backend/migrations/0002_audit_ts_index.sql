-- 0002_audit_ts_index.sql
-- The admin audit dashboard runs `SELECT ... FROM audit_log ORDER BY ts DESC LIMIT 200`
-- with no WHERE clause; the existing composite indexes (user_id, ts)
-- and (action, ts) can't satisfy a leading-column-free ORDER BY, so D1
-- falls back to a full scan + sort. A plain ts index makes that query
-- O(LIMIT) instead.

CREATE INDEX audit_ts ON audit_log(ts);

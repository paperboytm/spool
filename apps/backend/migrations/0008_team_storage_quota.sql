-- 0008_team_storage_quota.sql
--
-- The application performs a friendly preflight before aliasing immutable
-- objects into a Team, but a read-sum-write check cannot enforce a hard cap
-- when two requests race. These triggers make the 5 GiB tenant quota a D1
-- invariant. The existing oid is excluded so idempotent INSERT OR IGNORE
-- retries do not count the same content-addressed object twice.

CREATE TRIGGER hub_team_objects_quota_insert
BEFORE INSERT ON hub_team_objects
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(size), 0)
  FROM hub_team_objects
  WHERE team_id = NEW.team_id AND oid <> NEW.oid
) + NEW.size > 5368709120
BEGIN
  SELECT RAISE(ABORT, 'team storage quota exceeded');
END;

-- The current application only updates physical pack locations, but keep the
-- invariant intact if a future compaction or repair changes tenant/size/oid.
CREATE TRIGGER hub_team_objects_quota_update
BEFORE UPDATE OF team_id, oid, size ON hub_team_objects
FOR EACH ROW
WHEN (
  SELECT COALESCE(SUM(size), 0)
  FROM hub_team_objects
  WHERE team_id = NEW.team_id
    AND NOT (OLD.team_id = NEW.team_id AND oid = OLD.oid)
) + NEW.size > 5368709120
BEGIN
  SELECT RAISE(ABORT, 'team storage quota exceeded');
END;

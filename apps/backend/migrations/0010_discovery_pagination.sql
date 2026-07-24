-- 0010_discovery_pagination.sql
-- Complete the deterministic Recent keyset with its SID tie-breaker.

DROP INDEX hub_discovery_agent_published;
DROP INDEX hub_discovery_published;

CREATE INDEX hub_discovery_agent_published_sid
  ON hub_session_discovery(agent, published_at DESC, sid ASC);

CREATE INDEX hub_discovery_published_sid
  ON hub_session_discovery(published_at DESC, sid ASC);

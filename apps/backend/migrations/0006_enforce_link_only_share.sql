-- 0006_enforce_link_only_share.sql
-- Explore projections created by the old Hub Share path do not represent an
-- explicit Publish decision. Remove them (and their derived engagement) so
-- every existing and future Share is Link-only until separately published.

DELETE FROM hub_session_engagement_daily;
DELETE FROM hub_session_discovery;

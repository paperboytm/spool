-- 0005_explore.sql
-- Bounded public Explore projection and privacy-reduced daily engagement.

CREATE TABLE hub_session_discovery (
  sid TEXT PRIMARY KEY REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
  title TEXT NOT NULL,
  summary_text TEXT,
  search_text TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  file_count INTEGER NOT NULL DEFAULT 0,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  lineage_source_sid TEXT,
  quality_score INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX hub_discovery_agent_published
  ON hub_session_discovery(agent, published_at DESC);
CREATE INDEX hub_discovery_published
  ON hub_session_discovery(published_at DESC);

CREATE TABLE hub_session_engagement_daily (
  sid TEXT NOT NULL REFERENCES hub_sessions(sid) ON DELETE CASCADE,
  day TEXT NOT NULL,
  qualified_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sid, day)
);
CREATE INDEX hub_engagement_day ON hub_session_engagement_daily(day, sid);

-- Existing live shares receive lightweight placeholders. Their next head
-- commit replaces these values with evidence from the declared view object.
WITH RECURSIVE
eligible AS (
  SELECT
    sid,
    CASE WHEN sid LIKE 'claude\_%' ESCAPE '\' THEN 'claude' ELSE 'codex' END AS agent,
    COALESCE(note_md, '') AS summary_md,
    lineage_json,
    record_count,
    created_at,
    updated_at
  FROM hub_sessions
  WHERE visibility = 'unlisted'
    AND withdrawn_at IS NULL
    AND (sid LIKE 'claude\_%' ESCAPE '\' OR sid LIKE 'codex\_%' ESCAPE '\')
),
summary_lines(sid, rest, line, line_no) AS (
  SELECT sid, summary_md || char(10), '', 0 FROM eligible
  UNION ALL
  SELECT
    sid,
    substr(rest, instr(rest, char(10)) + 1),
    substr(rest, 1, instr(rest, char(10)) - 1),
    line_no + 1
  FROM summary_lines
  WHERE rest <> '' AND line_no < 100
),
cleaned_lines AS (
  SELECT
    sid,
    line_no,
    trim(
      replace(replace(replace(replace(replace(replace(replace(replace(
        ltrim(line, ' #>*_`~-+'),
        '**', ''), '__', ''), '`', ''), '[', ''), ']', ''), '*', ''), '_', ''), '~', '')
    ) AS clean_line
  FROM summary_lines
),
first_summary_line AS (
  SELECT line.sid, line.clean_line
  FROM cleaned_lines line
  WHERE line.clean_line <> ''
    AND lower(line.clean_line) NOT IN (
      'summary', 'outcome', 'overview', 'result', 'results', 'changes', 'what changed'
    )
    AND line.line_no = (
      SELECT min(candidate.line_no)
      FROM cleaned_lines candidate
      WHERE candidate.sid = line.sid
        AND candidate.clean_line <> ''
        AND lower(candidate.clean_line) NOT IN (
          'summary', 'outcome', 'overview', 'result', 'results', 'changes', 'what changed'
        )
    )
),
normalized AS (
  SELECT
    eligible.*,
    substr(COALESCE(first_summary_line.clean_line, ''), 1, 4000) AS summary_text,
    first_summary_line.clean_line AS summary_title
  FROM eligible
  LEFT JOIN first_summary_line ON first_summary_line.sid = eligible.sid
),
prepared AS (
  SELECT
    normalized.*,
    substr(
      CASE
        WHEN summary_title IS NOT NULL THEN summary_title
        WHEN agent = 'claude' THEN 'Claude Code session'
        ELSE 'Codex CLI session'
      END,
      1,
      200
    ) AS title
  FROM normalized
)
INSERT INTO hub_session_discovery (
  sid,
  agent,
  title,
  summary_text,
  search_text,
  message_count,
  tool_call_count,
  file_count,
  additions,
  deletions,
  lineage_source_sid,
  quality_score,
  published_at,
  updated_at
)
SELECT
  sid,
  agent,
  title,
  CASE WHEN summary_text = '' THEN NULL ELSE summary_text END,
  lower(substr(
    title || ' ' || summary_text || ' ' ||
      CASE WHEN agent = 'claude' THEN 'claude claude code' ELSE 'codex codex cli' END,
    1,
    4000
  )),
  0,
  0,
  0,
  0,
  0,
  CASE
    WHEN lineage_json IS NOT NULL
      AND json_valid(lineage_json)
      AND json_type(lineage_json, '$.source.sid') = 'text'
      AND (
        (
          json_extract(lineage_json, '$.source.sid') LIKE 'claude\_%' ESCAPE '\'
          AND length(substr(json_extract(lineage_json, '$.source.sid'), 8)) BETWEEN 8 AND 64
          AND substr(json_extract(lineage_json, '$.source.sid'), 8) NOT GLOB '*[^0-9A-Za-z-]*'
        )
        OR
        (
          json_extract(lineage_json, '$.source.sid') LIKE 'codex\_%' ESCAPE '\'
          AND length(substr(json_extract(lineage_json, '$.source.sid'), 7)) BETWEEN 8 AND 64
          AND substr(json_extract(lineage_json, '$.source.sid'), 7) NOT GLOB '*[^0-9A-Za-z-]*'
        )
      )
    THEN json_extract(lineage_json, '$.source.sid')
    ELSE NULL
  END,
  (CASE WHEN trim(summary_md) <> '' THEN 6 ELSE 0 END) +
    (CASE WHEN summary_title IS NOT NULL THEN 4 ELSE 0 END) +
    (CASE WHEN record_count >= 10 THEN 2 ELSE 0 END),
  created_at,
  updated_at
FROM prepared;

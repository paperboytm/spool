# Explore v1 — data model and web/backend contract

This document is the implementation contract for the first public Explore surface.
`packages/session-kit/src/discovery.ts` is the shared TypeScript wire type.

## Product rule for v1

For this release, **Share is public and discoverable**. Every live Hub Session with the existing
internal `visibility = 'unlisted'` value is eligible for Explore and search. The old internal value
is retained to avoid a destructive Hub table rebuild; it must not be exposed as “Link-only” in the
Explore UI. Withdrawn Sessions are never returned.

The sharing confirmation must say that the Session can appear in Explore and search. There is no
separate Publish control in this version.

This rule deliberately supersedes the longer-term Share/Publish split in `DESIGN.md` for this
implementation only.

## Source of truth

- `hub_sessions` remains authoritative for ownership, lifecycle, Summary, lineage, and record count.
- R2 Hub view objects remain authoritative for machine-derived evidence.
- A new D1 projection, `hub_session_discovery`, makes list/search reads bounded and prevents N R2
  reads per Explore request.
- A new daily aggregate, `hub_session_engagement_daily`, stores privacy-reduced qualified-read
  counts used only for ranking. Explore does not display raw view counts.

## D1 projection

Migration `0005_explore.sql` should create the following logical schema. Exact SQL types and index
names may follow repository conventions.

```sql
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
  day TEXT NOT NULL,                    -- UTC YYYY-MM-DD
  qualified_reads INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sid, day)
);
CREATE INDEX hub_engagement_day ON hub_session_engagement_daily(day, sid);
```

D1's documented baseline search mechanism is `LIKE`; v1 therefore uses a bounded, normalized
`search_text` projection rather than assuming FTS5. Limit the query to five non-empty tokens and
candidate reads to a small bounded set. A dedicated full-text or semantic index can replace the
retrieval stage later without changing the response contract.

### Projection materialization

After a successful Hub head commit, read the one declared `viewOid`, validate it as a
`SessionViewV1`, and upsert the projection:

- `agent`: derived from the SID prefix.
- `title`: first non-empty line of `view.firstPrompt`, bounded to 200 characters. Fallback to the
  first meaningful Summary line, then `Claude Code session` / `Codex CLI session`.
- `summary_text`: Markdown markers removed, whitespace collapsed, bounded to 4,000 characters.
- `search_text`: lowercase concatenation of title, Summary text, first/last message excerpts, file
  paths, and agent label, bounded to 16 KiB.
- evidence counts: derived from the view index and diffstat; `records` continues to come from
  `hub_sessions.record_count`.
- lineage: parse only a valid source SID from `lineage_json`; malformed lineage becomes null.
- `published_at`: original `hub_sessions.created_at`; re-sharing updates `updated_at` but does not
  make old work look newly published.

The migration should backfill lightweight placeholder projections for existing live Hub Sessions.
A later re-share heals them with full view evidence. Placeholder titles must use a meaningful
Summary line or agent fallback, never expose the raw SID as the visible title.

### Quality score

Materialize a deterministic integer score from 0–20:

- +6: non-empty Summary
- +4: title came from content rather than the agent fallback
- +4: one or more changed files
- +2: at least two message records
- +2: at least one tool/edit record
- +2: at least ten records

Length alone is not a quality signal.

## Public API

### List and search Sessions

```http
GET /api/discovery/v1/sessions
```

Query parameters:

| Name     | Values                              | Default       | Rules                                              |
| -------- | ----------------------------------- | ------------- | -------------------------------------------------- |
| `q`      | string                              | absent        | trim; 1–120 characters when present                |
| `sort`   | `recommended`, `trending`, `recent` | `recommended` | unknown values are `400 BAD_REQUEST`               |
| `agent`  | `claude`, `codex`                   | absent        | unknown values are `400 BAD_REQUEST`               |
| `limit`  | integer 1–50                        | `20`          | invalid values are `400 BAD_REQUEST`               |
| `cursor` | opaque base64url string             | absent        | malformed/mismatched cursors are `400 BAD_REQUEST` |

The response is `DiscoverySessionsResponse`:

```json
{
  "version": 1,
  "items": [
    {
      "sid": "claude_…",
      "title": "Prevent refresh-token races across browser tabs",
      "summaryExcerpt": "Implemented a single-flight refresh path…",
      "agent": "claude",
      "author": {
        "handle": "maya",
        "displayName": "Maya Chen",
        "avatarUrl": "/api/avatars/…"
      },
      "evidence": {
        "records": 96,
        "messages": 42,
        "toolCalls": 18,
        "files": 7,
        "additions": 214,
        "deletions": 63
      },
      "lineage": null,
      "publishedAt": 1784430000000,
      "updatedAt": 1784430000000
    }
  ],
  "nextCursor": null
}
```

Rules:

- Only live Hub Sessions are returned: `visibility = 'unlisted'`, `withdrawn_at IS NULL`, and owner
  account not deleted.
- Author values are resolved at read time so profile edits do not require reindexing.
- `summaryExcerpt` is plain text and bounded to 360 characters.
- Cursors are opaque to clients. v1 may encode an offset plus a fingerprint of `q/sort/agent`; a
  cursor cannot be reused with different filters.
- Do not return internal rank scores, raw search text, visibility, owner IDs, IP-derived data, or
  full Markdown.
- Set a short public cache policy (for example 30 seconds plus stale-while-revalidate). Withdrawal
  must disappear after that bounded window.
- Errors use the repository envelope: `{ "error": "BAD_REQUEST", "detail": "…" }`.

### Qualified-read signal

```http
POST /api/discovery/v1/sessions/:sid/engagement
Content-Type: application/json

{ "kind": "qualified_read" }
```

Response: `DiscoveryEngagementResponse`, `{ "accepted": true | false }`.

A web reader sends this once after the page has been actively open for at least 30 seconds and the
reader has either reached meaningful reading depth or interacted with Session evidence. The server
must:

- reject unknown/withdrawn Sessions as `404`;
- rate-limit abuse;
- deduplicate one reader/session/UTC-day using a short-lived KV key derived from a SHA-256 digest of
  IP, user agent, SID, and day;
- never persist raw IP or user agent;
- increment the daily D1 aggregate only when accepted;
- return `accepted: false` for a duplicate rather than treating it as an error.

Every Promise must be awaited or passed to the request context's `waitUntil`; no floating writes.

## Ranking v1

Ranking happens after a bounded candidate retrieval.

### Recommended

```text
quality_score
+ 8 × ln(1 + qualified_reads_last_7_days)
+ 12 × 2 ^ (-age_in_days / 14)
```

Tie-break: `published_at DESC`, then `sid ASC`.

### Trending

```text
ln(1 + qualified_reads_last_7_days)
× 2 ^ (-age_in_days / 7)
+ 0.05 × quality_score
```

Tie-break: `published_at DESC`, then `sid ASC`.

### Recent

`published_at DESC`, then `sid ASC`.

### Search

When `q` is present, relevance is primary and the selected sort is the tie-breaker. Match title,
Summary, first/last excerpts, file paths, agent label, handle, and display name. Exact/title matches
must outrank popularity. Search must never return a nonmatching Session merely because it is
popular.

## Frontend behavior

`/explore` uses the user-approved X-style discovery shell while retaining Spool's Warm Index visual
system:

- Desktop: fixed left navigation, 640–720px bordered center feed, 300–320px right utility rail.
- Center header: sticky search input, followed by `For you`, `Trending`, `Recent` tabs.
- Search state: same shell and feed rows; tabs become `Top` and `Latest`. The right rail carries
  agent filters.
- Feed rows are edge-to-edge with 1px dividers, not floating cards. Each row shows author
  attribution, title, 2–3 lines of Summary, source agent, machine evidence, and lineage when present.
- No likes, reposts, generic view counts, fake trends, emoji, blue/purple accents, or visibility
  filter.
- Empty query renders recommended content immediately. Empty search/filter states explain the
  active constraint and provide a clear reset.
- Loading preserves row geometry with warm-neutral skeletons.
- On narrower layouts, progressively remove the right rail and collapse left navigation without
  removing search or the feed.

Frontend requests are same-origin, use URL parameters as page state, treat the cursor as opaque,
and abort stale searches. The API client imports the shared wire types from
`@spool-lab/session-kit` rather than redeclaring them.

## Ownership split

- Backend worker owns `apps/backend/**`, migrations, projection materialization, ranking/search,
  engagement, and backend tests/fakes.
- Frontend worker owns `apps/web/**`, `/explore`, the X-style shell, API client, qualified-read
  trigger in the Session reader, and web tests.
- Both treat this document and `packages/session-kit/src/discovery.ts` as read-only. Contract
  changes require coordinator approval.

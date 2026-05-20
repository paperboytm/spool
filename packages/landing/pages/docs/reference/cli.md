---
title: CLI Commands
description: Reference for the spool command-line interface.
---

The `spool` CLI gives you the same search engine as the app, from any terminal. Install it with:

```bash
npm install -g @spool-lab/cli
```

The CLI reads from the same `~/.spool/spool.db` index the app maintains.

## `spool search`

Full-text search across all indexed sessions.

```bash
spool search "auth middleware"
spool search "auth middleware" --source claude
spool search "auth middleware" --source gemini
spool search "auth middleware" --source opencode
spool search "auth"  --json -n 10
spool search "fix" --since 7d
spool search '"auth middleware"'   # exact phrase
```

By default, whitespace-separated terms are treated as a multi-keyword search, so `auth middleware` matches entries that contain both terms even when they aren't adjacent. Natural multi-term searches prioritize exact-phrase hits first, then broader all-terms matches. For an exact-phrase-only match, wrap in explicit FTS quotes inside the query string.

## `spool list`

List recent sessions across sources.

```bash
spool list                     # recent across all sources
spool list -s opencode -n 10   # filter by source
spool list --json              # machine-readable
```

## `spool show`

Print the full content of one session.

```bash
spool show <uuid>
spool show <uuid> --json
```

## `spool sync`

Trigger indexing of new sessions, or watch continuously.

```bash
spool sync
spool sync --watch
```

## `spool status`

Show index statistics (session count, DB size, last sync).

```bash
spool status
```

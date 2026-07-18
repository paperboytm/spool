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

Show one session — local uuid, shared session id, or share URL. Local
sessions print the full transcript; shared sessions open on a summary.

```bash
spool show <uuid>              # full local transcript
spool show <sid|url>           # shared session: first-screen summary
spool show <session> --log     # record timeline
spool show <session> --diff    # composed net diff across the session
spool show <session>@r3        # land on record 3
spool show <uuid> --json
```

## `spool projects`

List projects across sources, or the sessions inside one.

```bash
spool projects                 # all projects, grouped across sources
spool projects spool           # sessions in a project (name, identity, path, or cwd)
spool projects spool -n 50
spool projects spool --json
```

## `spool pin`

Pin sessions to the top of your library — shared with the desktop app.

```bash
spool pin <uuid>
spool unpin <uuid>
spool pinned                   # list pinned sessions
```

## `spool login`

Sign in to the Spool hub via browser approval. The CLI polls for the
token, so this works over SSH too — open the printed link in any browser.

```bash
spool login
spool login --token <t>        # paste a hub API token (CI / scripts)
```

## `spool logout`

Sign out: revoke this machine's token on the hub and delete the local
credentials. If the hub is unreachable, local credentials are removed
anyway — revoke the token from your account page when you get back
online.

```bash
spool logout
```

## `spool share`

Share a session to [spool.pro](https://spool.pro) and get a URL. It scans
for secrets and uploads first. In an interactive terminal, Spool then detects
Claude Code and Codex CLI, asks whether to generate a Summary locally, and
automatically uploads the result.

```bash
spool share                    # upload, then offer a detected local Agent
spool share <uuid>             # a specific session (uuid prefixes work)
spool share <uuid>@12          # only the first 12 records
spool share --no-agent-summary # skip the post-share Agent offer
spool share --summary "..."    # advanced: provide Summary Markdown directly
spool share --yes              # skip the secret-findings confirmation
```

## `spool resume`

Materialize a shared session locally and fork it in the provider's
native tool (Claude Code or Codex), branching cleanly from the share
point.

```bash
spool resume <sid|url>
spool resume <sid>@12          # fork at record 12 (first 12 records only)
spool resume --workspace <dir> # resume in a specific workspace root
spool resume --no-exec         # print the native command instead of launching
```

## `spool withdraw`

Take a shared session down. Withdrawn shares are tombstoned — the URL
stops resolving.

```bash
spool withdraw <sid|url>
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

## `spool doctor`

Diagnose your environment, database, and config.

```bash
spool doctor
spool doctor db.integrity      # run a single check by id
spool doctor --json
spool doctor --fix             # apply safe fixes
spool doctor --fix --force     # also apply destructive fixes
```

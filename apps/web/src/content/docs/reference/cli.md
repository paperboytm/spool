---
title: CLI Commands
description: Reference for sharing, reading, resuming, and managing Sessions with the spool CLI.
---

Install the CLI globally:

```bash
npm install -g @spool-lab/cli
```

The CLI uses the same local data directory as Desktop and provides the stable shell interface for users, agents, and automation.

## `spool login`

Approve this machine for Hub access in a browser. The polling flow works over SSH.

```bash
spool login
spool login --token <token> # controlled automation
```

## `spool logout`

Revoke this machine’s Hub token and remove the local credential:

```bash
spool logout
```

If the Hub is unreachable, the local credential is still removed. Revoke the server-side token from the account surface later.

## `spool share`

Create a durable public Shared Session URL that can appear in Explore and search. Spool checks the selected records for likely sensitive values before upload and asks for confirmation before disclosure.

```bash
spool share                       # latest Session in the current directory
spool share <uuid>                # specific Session; UUID prefixes work
spool share <uuid>@12             # first 12 records only
spool share --summary "..."       # provide Summary Markdown
spool share --no-agent-summary    # skip the local Agent offer
spool share --spool-file x.spool  # attach a curated document
spool share --yes                 # skip sensitive-data confirmation
```

Only Claude Code and Codex CLI Sessions can currently be shared through the Hub.

In an interactive terminal, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary after the records have been shared. Summary generation uses the author’s own local Agent configuration.

`--yes` is intended for controlled automation. It does not remove sensitive values.

## `spool withdraw`

Make a Shared Session unavailable:

```bash
spool withdraw <session-id-or-url>
```

Withdrawal cannot revoke copies that were already downloaded.

## `spool resume`

Verify and materialize a Shared Session as new provider-native work:

```bash
spool resume <session-id-or-url>
spool resume <session-id>@12          # continue from a record prefix
spool resume <url> --workspace <dir>  # choose the workspace root
spool resume <url> --no-exec          # prepare without launching the agent
```

Resume never modifies the source Shared Session.

## `spool show`

Read a local or Shared Session at different depths:

```bash
spool show <uuid>                 # local conversation
spool show <session-id-or-url>    # Shared Session overview
spool show <session> --log        # record timeline
spool show <session> --diff       # composed net diff
spool show <session>@r3           # specific record
spool show <session> --json       # machine-readable output
```

## `spool sync`

Prepare Sessions from supported local agent sources:

```bash
spool sync
spool sync --watch
```

Sync is local and does not publish anything.

## `spool list`

List recent local Sessions:

```bash
spool list
spool list -s codex -n 10
spool list --json
```

## `spool projects`

List projects across sources or Sessions within one project:

```bash
spool projects
spool projects spool
spool projects spool -n 50
spool projects spool --json
```

A query can match project name, identity, path, or Session working directory. Exact names win over partial matches.

## `spool search`

Search prepared local Sessions:

```bash
spool search "auth middleware"
spool search "auth middleware" --source claude
spool search "fix" --since 7d
spool search "auth" --json -n 10
spool search '"auth middleware"' # exact phrase only
```

Whitespace-separated terms use all-term matching with exact-phrase hits ranked first. Wrap the query in FTS quotes for phrase-only matching.

## Pins

Pins are private organization state shared with Desktop:

```bash
spool pin <uuid>
spool unpin <uuid>
spool pinned
spool pinned --json
```

Pins do not affect Public Profile order or Discovery ranking.

## `spool status`

Show local preparation statistics:

```bash
spool status
```

## `spool doctor`

Diagnose local data, native dependencies, and configuration:

```bash
spool doctor
spool doctor db.integrity
spool doctor --json
spool doctor --fix
spool doctor --fix --force
```

`--fix --force` may apply destructive repairs; review the reported check before using it.

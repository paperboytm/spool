---
title: CLI Commands
description: Reference for sharing, reading, resuming, and managing Sessions with the spool CLI.
---

Install the CLI once:

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Open a new terminal, then verify the installation with `spool --version`.

The CLI stores prepared Sessions in the local Spool data directory and provides the stable shell interface for users, agents, and automation.

## `spool`

Run the default flow from a project directory:

```bash
spool
```

This refreshes the local index, signs in through the browser if needed, and starts a Share for the latest Session in the current project. Spool still shows the selected records, sensitive-data findings, and resulting visibility before upload. Use `spool share` when you need to select a Session or pass options.

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

Create a durable Shared Session URL. Claude Code and Codex CLI Sessions are Public in Explore and search by default; providers not yet supported by Explore remain Link-only. Spool checks the selected records for likely sensitive values before upload and asks for confirmation before disclosure. Non-interactive callers must pass `--visibility-confirmed`, which acknowledges visibility without bypassing sensitive-data findings.

The CLI reports this initial Public or Link-only result. Team transfer is a separate, confirmed action on [your account page](/me): choosing `Team · name` makes the hosted asset Team-owned and limits reading to current members until a Team Owner or Admin changes its visibility.

```bash
spool share                        # latest Session in the current directory
spool share <uuid>                 # specific Session; UUID prefixes work
spool share <uuid>@12              # first 12 records only
spool share --no-agent-summary     # skip the local Agent offer
spool share --spool-file x.spool   # attach a curated document
spool share --visibility-confirmed # acknowledge visibility without a TTY
spool share --yes                  # skip all confirmations, including secret findings
```

Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions can be shared through the Hub. Claude and Codex preserve their native records; the other sources share the provider-neutral conversation prepared in the local index.

In an interactive terminal, omit Summary options. After the Session URL is live, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary using the author’s own local Agent configuration.

`--summary <markdown>` is an advanced manual or automation input. It uploads exactly the Markdown supplied by the caller after the Session is shared; it does not generate a Summary.

`--yes` is intended for controlled automation. It accepts visibility and sensitive-data findings; it does not remove sensitive values.

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

Native Resume currently supports Claude Code and Codex CLI shares. Gemini CLI, OpenCode, and Pi shares remain readable but are not offered as resumable.

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

List recent local Sessions for the project containing the current working directory:

```bash
spool list
spool list -s codex -n 10
spool list --json
spool list --all
```

`--all` ignores the current-project scope and lists recent Sessions across every project. It
still respects `--limit`; combine it with `--project <path>` to query a different project.

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

Pins are private local organization state:

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

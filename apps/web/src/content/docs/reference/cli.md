---
title: CLI Commands
description: Reference for sharing, reading, resuming, and managing Sessions with the spool CLI.
---

Run any command with npx; no global install is required:

```bash
npx @spool-lab/cli --version
```

If you prefer the shorter `spool` command, run `npm install -g @spool-lab/cli` once and use
`spool …` afterward.

The CLI stores prepared Sessions in the local Spool data directory and provides the stable shell interface for users, agents, and automation.

## `npx @spool-lab/cli login`

Approve this machine for Hub access in a browser. The polling flow works over SSH.

```bash
npx @spool-lab/cli login
npx @spool-lab/cli login --token <token> # controlled automation
```

## `npx @spool-lab/cli logout`

Revoke this machine’s Hub token and remove the local credential:

```bash
npx @spool-lab/cli logout
```

If the Hub is unreachable, the local credential is still removed. Revoke the server-side token from the account surface later.

## `npx @spool-lab/cli share`

Create a durable Link-only Shared Session URL. Publishing it to a Profile and Explore remains a separate action. Spool checks the selected records for likely sensitive values before upload and asks for confirmation before disclosure.

```bash
npx @spool-lab/cli share                       # latest Session in the current directory
npx @spool-lab/cli share <uuid>                # specific Session; UUID prefixes work
npx @spool-lab/cli share <uuid>@12             # first 12 records only
npx @spool-lab/cli share --summary "..."       # provide Summary Markdown
npx @spool-lab/cli share --no-agent-summary    # skip the local Agent offer
npx @spool-lab/cli share --spool-file x.spool  # attach a curated document
npx @spool-lab/cli share --yes                 # skip sensitive-data confirmation
```

Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions can be shared through the Hub. Claude and Codex preserve their native records; the other sources share the provider-neutral conversation prepared in the local index.

In an interactive terminal, Spool can detect a local Claude Code or Codex CLI installation and ask it to draft the Summary after the records have been shared. Summary generation uses the author’s own local Agent configuration.

`--yes` is intended for controlled automation. It does not remove sensitive values.

## `npx @spool-lab/cli withdraw`

Make a Shared Session unavailable:

```bash
npx @spool-lab/cli withdraw <session-id-or-url>
```

Withdrawal cannot revoke copies that were already downloaded.

## `npx @spool-lab/cli resume`

Verify and materialize a Shared Session as new provider-native work:

```bash
npx @spool-lab/cli resume <session-id-or-url>
npx @spool-lab/cli resume <session-id>@12          # continue from a record prefix
npx @spool-lab/cli resume <url> --workspace <dir>  # choose the workspace root
npx @spool-lab/cli resume <url> --no-exec          # prepare without launching the agent
```

Native Resume currently supports Claude Code and Codex CLI shares. Gemini CLI, OpenCode, and Pi shares remain readable but are not offered as resumable.

Resume never modifies the source Shared Session.

## `npx @spool-lab/cli show`

Read a local or Shared Session at different depths:

```bash
npx @spool-lab/cli show <uuid>                 # local conversation
npx @spool-lab/cli show <session-id-or-url>    # Shared Session overview
npx @spool-lab/cli show <session> --log        # record timeline
npx @spool-lab/cli show <session> --diff       # composed net diff
npx @spool-lab/cli show <session>@r3           # specific record
npx @spool-lab/cli show <session> --json       # machine-readable output
```

## `npx @spool-lab/cli sync`

Prepare Sessions from supported local agent sources:

```bash
npx @spool-lab/cli sync
npx @spool-lab/cli sync --watch
```

Sync is local and does not publish anything.

## `npx @spool-lab/cli list`

List recent local Sessions for the project containing the current working directory:

```bash
npx @spool-lab/cli list
npx @spool-lab/cli list -s codex -n 10
npx @spool-lab/cli list --json
npx @spool-lab/cli list --all
```

`--all` ignores the current-project scope and lists recent Sessions across every project. It
still respects `--limit`; combine it with `--project <path>` to query a different project.

## `npx @spool-lab/cli projects`

List projects across sources or Sessions within one project:

```bash
npx @spool-lab/cli projects
npx @spool-lab/cli projects spool
npx @spool-lab/cli projects spool -n 50
npx @spool-lab/cli projects spool --json
```

A query can match project name, identity, path, or Session working directory. Exact names win over partial matches.

## `npx @spool-lab/cli search`

Search prepared local Sessions:

```bash
npx @spool-lab/cli search "auth middleware"
npx @spool-lab/cli search "auth middleware" --source claude
npx @spool-lab/cli search "fix" --since 7d
npx @spool-lab/cli search "auth" --json -n 10
npx @spool-lab/cli search '"auth middleware"' # exact phrase only
```

Whitespace-separated terms use all-term matching with exact-phrase hits ranked first. Wrap the query in FTS quotes for phrase-only matching.

## Pins

Pins are private local organization state:

```bash
npx @spool-lab/cli pin <uuid>
npx @spool-lab/cli unpin <uuid>
npx @spool-lab/cli pinned
npx @spool-lab/cli pinned --json
```

Pins do not affect Public Profile order or Discovery ranking.

## `npx @spool-lab/cli status`

Show local preparation statistics:

```bash
npx @spool-lab/cli status
```

## `npx @spool-lab/cli doctor`

Diagnose local data, native dependencies, and configuration:

```bash
npx @spool-lab/cli doctor
npx @spool-lab/cli doctor db.integrity
npx @spool-lab/cli doctor --json
npx @spool-lab/cli doctor --fix
npx @spool-lab/cli doctor --fix --force
```

`--fix --force` may apply destructive repairs; review the reported check before using it.

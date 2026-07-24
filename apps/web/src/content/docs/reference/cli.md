---
title: CLI Commands
description: Reference for sharing, subscribing, reading, resuming, and managing Sessions with the spool CLI.
---

Install the CLI once:

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Open a new terminal, then verify the installation with `spool --version`.

The CLI stores prepared Sessions in the local Spool data directory and provides the stable shell interface for users, agents, and automation. The everyday command set is deliberately small: configure trust once (`login`, `subscribe`), keep the `daemon` running, and handle exceptions explicitly (`share`, `visibility`, `withdraw`, `resume`). Browsing lives under `spool sessions`.

## `spool`

Run the default flow from a project directory:

```bash
spool
```

In a subscribed directory this refreshes the local index and runs one catch-up publish pass. Elsewhere it refreshes the index, signs in through the browser if needed, and starts a Share for the latest Session in the current project. Spool still shows the selected records, sensitive-data findings, and resulting visibility before upload. Use `spool share` when you need to select a Session or pass options.

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

## `spool subscribe`

Record the one-time decision that Sessions from a directory — including its git worktrees and worktrees managed by tools like superset or orca — publish automatically:

```bash
spool subscribe                        # current directory, interactive disclosure choice
spool subscribe <dir> --team <name-or-id>  # Team · {name}: current members only
spool subscribe <dir> --link-only      # anyone with the URL
spool subscribe <dir> --public         # explicit opt-in to Explore and search
spool subscribe <dir> --link-only --yes  # non-interactive
```

The disclosure target is always an explicit choice among `Team · {name}`, Link-only, and Public. There is no implicit default and Public is never preselected; interactive runs list your Teams first. Non-interactive callers must pass exactly one disclosure flag.

Sessions with likely sensitive values are never auto-published: they are skipped with a warning and left for an explicit `spool share`.

```bash
spool unsubscribe [dir]   # stop auto-publishing; published Sessions stay live
spool subscriptions       # list subscribed directories and their disclosure
```

## `spool teams`

List the Teams you belong to, with your role and the member count:

```bash
spool teams
spool teams --json
```

Every `--team` option (`spool subscribe`, `spool visibility`) accepts a Team name as printed here; the id is only needed when two Teams share a name.

## `spool daemon`

The always-on half of continuous publishing — a watcher plus auto-publish loop supervised by the OS service manager (launchd on macOS, a systemd user unit on Linux):

```bash
spool daemon start    # register and start at login, restart on failure
spool daemon stop     # stop and unregister
spool daemon status   # heartbeat, subscriptions, log location
spool daemon logs     # print the log tail (-n <count>)
spool daemon run      # the same loop in the foreground
```

## `spool share`

Create a durable Shared Session URL. Claude Code and Codex CLI Sessions are Public in Explore and search by default; providers not yet supported by Explore remain Link-only. Spool checks the selected records for likely sensitive values before upload and asks for confirmation before disclosure. Non-interactive callers must pass `--visibility-confirmed`, which acknowledges visibility without bypassing sensitive-data findings.

The CLI reports this initial Public or Link-only result. Use `spool visibility` or [your account page](/me) to move a Session to `Team · name` afterward: that makes the hosted asset Team-owned and limits reading to current members until a Team Owner or Admin changes its visibility.

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

## `spool visibility`

Change a published Session’s disclosure without re-uploading records. Disclosure changes are named, confirmed actions:

```bash
spool visibility <sid|url> public                 # Team → Public keeps Team ownership
spool visibility <sid|url> link-only
spool visibility <sid|url> team --team <name-or-id>
```

Changing a Team-owned Session requires a Team Owner or Admin role. Moving a personal Session into a Team transfers ownership of the hosted asset to the Team. Public → Team removes all public discovery projections before the change is reported complete.

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

## `spool sessions`

Browse, search, and read prepared local Sessions. Browsing never publishes anything.

### `spool sessions show`

```bash
spool sessions show <uuid>                 # local conversation
spool sessions show <session-id-or-url>    # Shared Session overview
spool sessions show <session> --log        # record timeline
spool sessions show <session> --diff       # composed net diff
spool sessions show <session>@r3           # specific record
spool sessions show <session> --json       # machine-readable output
```

### `spool sessions list`

List recent local Sessions for the project containing the current working directory:

```bash
spool sessions list
spool sessions list -s codex -n 10
spool sessions list --json
spool sessions list --all
```

`--all` ignores the current-project scope and lists recent Sessions across every project. It
still respects `--limit`; combine it with `--project <path>` to query a different project.

### `spool sessions search`

```bash
spool sessions search "auth middleware"
spool sessions search "auth middleware" --source claude
spool sessions search "fix" --since 7d
spool sessions search "auth" --json -n 10
spool sessions search '"auth middleware"' # exact phrase only
```

Whitespace-separated terms use all-term matching with exact-phrase hits ranked first. Wrap the query in FTS quotes for phrase-only matching.

## `spool doctor`

Diagnose local data, native dependencies, configuration, and the daemon:

```bash
spool doctor
spool doctor db.integrity
spool doctor daemon.heartbeat
spool doctor --json
spool doctor --fix
spool doctor --fix --force
```

`spool doctor` includes the daemon heartbeat and local index statistics (previously `spool status`). `--fix --force` may apply destructive repairs; review the reported check before using it.

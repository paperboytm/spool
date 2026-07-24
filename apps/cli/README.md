# @spool-lab/cli

CLI for publishing, reading, resuming, and managing agent Sessions with [Spool](https://spool.new).

## Install

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Install once, open a new terminal, then verify the command with `spool --version`. After that, use `spool` from any project.

## Everyday Commands

The everyday surface is deliberately small. Configure trust once, keep the daemon running, and handle exceptions explicitly:

```bash
spool login                      # one-time hub credential
spool subscribe [dir]            # one-time disclosure decision per project
spool daemon start               # continuous publishing survives reboots
spool                            # in a subscribed dir: catch-up pass; elsewhere: share latest
spool share <session-uuid>       # explicit one-off share
spool visibility <sid|url> <target>  # change a published Session's disclosure
spool withdraw <session-id-or-url>
spool resume <session-id-or-url>
spool doctor                     # health: index, daemon, credentials, environment
spool logout
```

## Continuous Publishing

```bash
spool subscribe [dir] --team <name-or-id>   # Team · {name}: current members only
spool subscribe [dir] --link-only           # anyone with the URL
spool subscribe [dir] --public              # explicit opt-in to Explore/search
spool unsubscribe [dir]
spool subscriptions
spool teams                                 # list the Teams you belong to
spool daemon start|stop|status|logs|run
```

`--team` accepts a Team name (or id when two Teams share a name); `spool teams` shows exactly the names to use.

Subscribing a directory is the one-time disclosure decision: from then on, the daemon publishes new and updated Sessions recorded in that directory — including its git worktrees and worktrees managed by tools like superset or orca — without prompting. The disclosure target is always an explicit choice among `Team · {name}`, Link-only, and Public; **there is no implicit default and Public is never preselected**. Interactive `spool subscribe` offers your Teams first.

`spool daemon start` registers the watcher with launchd (macOS) or a systemd user unit (Linux) so it runs at login and restarts on failure. `spool daemon run` is the same loop in the foreground.

Sessions with likely sensitive values are never auto-published: they are skipped with a warning and left for an explicit `spool share`.

## Share and Continue

```bash
spool
spool share <session-uuid>
spool resume <session-id-or-url>
spool withdraw <session-id-or-url>
```

Bare `spool` adapts to context: in a subscribed directory it refreshes the index and runs one catch-up publish pass; elsewhere it refreshes the index, signs in if needed, and shares the latest Session in the current project. `spool share` is the explicit form for selecting a Session or passing options. Both flows check records for likely sensitive values, confirm the resulting visibility, create a durable URL, and can ask a detected local Agent to draft the optional Summary. Claude Code and Codex CLI Sessions are Public in Explore by default; providers not yet supported by Explore remain Link-only. Non-interactive callers must pass `--visibility-confirmed`; this does not bypass sensitive-data findings.

Useful publishing options:

```bash
spool share <uuid>@12              # first 12 records
spool share --no-agent-summary     # skip local Agent generation
spool share --spool-file x.spool   # attach a curated document
spool share --visibility-confirmed # acknowledge visibility without a TTY
spool share --yes                  # skip all confirmations, including secret findings
```

For the normal interactive flow, omit Summary options. After the Session URL is live, Spool can ask a detected local Agent to draft the optional Summary. `--summary <markdown>` is an advanced manual or automation input: it uploads exactly the Markdown supplied by the caller and does not generate a Summary.

For Claude Code and Codex CLI shares, Resume verifies the shared records, writes a new provider-native Session, preserves the source relationship, and launches the agent. Use `--workspace <dir>` to choose the project or `--no-exec` to prepare without launching.

## Change Disclosure Later

```bash
spool visibility <sid|url> public            # Team → Public keeps Team ownership
spool visibility <sid|url> link-only
spool visibility <sid|url> team --team <name-or-id>
```

Disclosure changes are named, confirmed actions and never re-upload records. Changing a Team-owned Session requires a Team Owner or Admin role; moving a personal Session into a Team transfers ownership to the Team. The same control exists on spool.new under your account's Sessions list.

## Browse Local Sessions

```bash
spool sessions list [-s <source>] [-p <path>] [-n <count>] [-a|--all] [--json]
spool sessions search <query> [-s <source>] [--since 7d] [-n 10] [--json]
spool sessions show <uuid>                 # local conversation
spool sessions show <session-id-or-url>    # Shared Session overview
spool sessions show <session> --log        # record timeline
spool sessions show <session> --diff       # composed net diff
spool sessions show <session>@r3           # specific record
```

Local indexing supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Browsing never publishes anything; only subscriptions and explicit shares do.

## Diagnostics

```bash
spool doctor
spool doctor <check-id>
spool doctor --json
spool doctor --fix
spool doctor --fix --force
```

`spool doctor` includes the daemon heartbeat and local index status (previously `spool status`).

## Local Data

The CLI uses `~/.spool/` by default:

- `spool.db` — local Session metadata, messages, search, and state
- `hub-credentials.json` — revocable Hub credential from `spool login`
- `subscriptions.json` — directories subscribed for continuous publishing
- `auto-publish-state.json` — per-Session fingerprints that keep auto-publish incremental
- `daemon.json` / `daemon.log` — daemon heartbeat and log

Set `SPOOL_DATA_DIR` to isolate a different data directory.

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

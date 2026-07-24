# @spool-lab/cli

CLI for publishing, reading, resuming, and managing agent Sessions with [Spool](https://spool.new).

## Install

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Install once, open a new terminal, then verify the command with `spool --version`. After that, use `spool` from any project.

## Share and Continue

```bash
spool
spool share <session-uuid>
spool resume <session-id-or-url>
spool withdraw <session-id-or-url>
```

Bare `spool` is the everyday path: it refreshes the local index, signs in if needed, and shares the latest Session in the current project. `spool share` is the explicit form for selecting a Session or passing options. Both flows check records for likely sensitive values, confirm the resulting visibility, create a durable URL, and can ask a detected local Agent to draft the optional Summary. Claude Code and Codex CLI Sessions are Public in Explore by default; providers not yet supported by Explore remain Link-only. Non-interactive callers must pass `--visibility-confirmed`; this does not bypass sensitive-data findings.

Public or Link-only is the initial CLI Share result. After sharing, use the spool.new account surface to move a Session to `Team · name`. That transfers control of the hosted asset to the Team and limits reading to current members until a Team Owner or Admin changes its visibility.

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

## Read Sessions

```bash
spool show <uuid>                 # local conversation
spool show <session-id-or-url>    # Shared Session overview
spool show <session> --log        # record timeline
spool show <session> --diff       # composed net diff
spool show <session>@r3           # specific record
spool show <session> --json       # machine-readable output
```

## Prepare and Find Local Sessions

```bash
spool sync [--watch]
spool list [-s <source>] [-p <path>] [-n <count>] [-a|--all] [--json]
spool projects [name] [-n <count>] [--json]
spool search <query> [-s <source>] [--since 7d] [-n 10] [--json]
spool status
```

Local preparation supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Sync and search do not publish anything unless you have subscribed directories for continuous publishing.

## Continuous Publishing

```bash
spool subscribe [dir] [--link-only] [--yes]   # auto-publish this directory's Sessions
spool unsubscribe [dir]
spool subscriptions
spool sync --watch                            # keep subscribed Sessions continuously published
```

Subscribing a directory is the one-time visibility decision: from then on, every `spool sync` (and continuously under `--watch`) publishes new and updated Sessions recorded in that directory — including its git worktrees and worktrees managed by tools like superset or orca — without prompting. Supported providers publish Public by default; pass `--link-only` to keep a subscription Link-only. Sessions with likely sensitive values are never auto-published: they are skipped with a warning and left for an explicit `spool share`.

## Private Organization

```bash
spool pin <uuid>
spool unpin <uuid>
spool pinned [--json]
```

Pin state is local and does not affect Public Profile order or Discovery ranking.

## Diagnostics

```bash
spool doctor
spool doctor <check-id>
spool doctor --json
spool doctor --fix
spool doctor --fix --force
```

## Local Data

The CLI uses `~/.spool/` by default:

- `spool.db` — local Session metadata, messages, search, and state
- `hub-credentials.json` — revocable Hub credential from `spool login`
- `subscriptions.json` — directories subscribed for continuous publishing
- `auto-publish-state.json` — per-Session fingerprints that keep auto-publish incremental

Set `SPOOL_DATA_DIR` to isolate a different data directory.

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

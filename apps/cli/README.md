# @spool-lab/cli

CLI for publishing, reading, resuming, and managing agent Sessions with [Spool](https://spool.pro).

## Install

```bash
npm install -g @spool-lab/cli
```

## Share and Continue

```bash
spool sync
spool login
spool share <session-uuid>
spool resume <session-id-or-url>
spool withdraw <session-id-or-url>
```

`spool share` supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions. It checks records for likely sensitive values, creates a Link-only URL, and can ask a detected local Agent to draft the optional Summary.

Useful publishing options:

```bash
spool share <uuid>@12             # first 12 records
spool share --summary "..."       # provide Summary Markdown
spool share --no-agent-summary    # skip local Agent generation
spool share --spool-file x.spool  # attach a curated document
spool share --yes                 # skip sensitive-data confirmation
```

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

Local preparation supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Sync and search do not publish anything.

## Private Organization

```bash
spool pin <uuid>
spool unpin <uuid>
spool pinned [--json]
```

Pin state is shared with Desktop and does not affect Public Profile order or Discovery ranking.

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

Set `SPOOL_DATA_DIR` to isolate a different data directory.

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

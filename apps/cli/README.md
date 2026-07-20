# @spool-lab/cli

CLI for publishing, reading, resuming, and managing agent Sessions with [Spool](https://spool.pro).

## Run

```bash
npx @spool-lab/cli --version
```

No global install is required. If you prefer the shorter `spool` command, run
`npm install -g @spool-lab/cli` once and use `spool …` afterward.

## Share and Continue

```bash
npx @spool-lab/cli sync
npx @spool-lab/cli login
npx @spool-lab/cli share <session-uuid>
npx @spool-lab/cli resume <session-id-or-url>
npx @spool-lab/cli withdraw <session-id-or-url>
```

`npx @spool-lab/cli share` supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions. It checks records for likely sensitive values, creates a Link-only URL, and can ask a detected local Agent to draft the optional Summary.

Useful publishing options:

```bash
npx @spool-lab/cli share <uuid>@12             # first 12 records
npx @spool-lab/cli share --summary "..."       # provide Summary Markdown
npx @spool-lab/cli share --no-agent-summary    # skip local Agent generation
npx @spool-lab/cli share --spool-file x.spool  # attach a curated document
npx @spool-lab/cli share --yes                 # skip sensitive-data confirmation
```

For Claude Code and Codex CLI shares, Resume verifies the shared records, writes a new provider-native Session, preserves the source relationship, and launches the agent. Use `--workspace <dir>` to choose the project or `--no-exec` to prepare without launching.

## Read Sessions

```bash
npx @spool-lab/cli show <uuid>                 # local conversation
npx @spool-lab/cli show <session-id-or-url>    # Shared Session overview
npx @spool-lab/cli show <session> --log        # record timeline
npx @spool-lab/cli show <session> --diff       # composed net diff
npx @spool-lab/cli show <session>@r3           # specific record
npx @spool-lab/cli show <session> --json       # machine-readable output
```

## Prepare and Find Local Sessions

```bash
npx @spool-lab/cli sync [--watch]
npx @spool-lab/cli list [-s <source>] [-p <path>] [-n <count>] [-a|--all] [--json]
npx @spool-lab/cli projects [name] [-n <count>] [--json]
npx @spool-lab/cli search <query> [-s <source>] [--since 7d] [-n 10] [--json]
npx @spool-lab/cli status
```

Local preparation supports Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Sync and search do not publish anything.

## Private Organization

```bash
npx @spool-lab/cli pin <uuid>
npx @spool-lab/cli unpin <uuid>
npx @spool-lab/cli pinned [--json]
```

Pin state is local and does not affect Public Profile order or Discovery ranking.

## Diagnostics

```bash
npx @spool-lab/cli doctor
npx @spool-lab/cli doctor <check-id>
npx @spool-lab/cli doctor --json
npx @spool-lab/cli doctor --fix
npx @spool-lab/cli doctor --fix --force
```

## Local Data

The CLI uses `~/.spool/` by default:

- `spool.db` — local Session metadata, messages, search, and state
- `hub-credentials.json` — revocable Hub credential from `npx @spool-lab/cli login`

Set `SPOOL_DATA_DIR` to isolate a different data directory.

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

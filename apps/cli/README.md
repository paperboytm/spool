# @spool-lab/cli

Command-line interface for [Spool](https://spool.pro) — search your AI sessions from the terminal.

## Install

```bash
npm install -g @spool-lab/cli
```

This gives you the `spool` command.

## Commands

### Search & browse

```bash
spool search <query>           # Full-text search across all AI sessions
spool search "auth" --json     # Output as JSON
spool search "bug" -n 5        # Limit results
spool search "fix" --since 7d  # Only recent sessions

spool list                     # List recent sessions
spool list -s opencode -n 10   # Filter by source
spool list --json              # Output as JSON

spool show <uuid>              # Print full session content
spool show <sid|url>           # Shared session: first-screen summary
spool show <session> --log     # Record timeline
spool show <session> --diff    # Composed net diff across the session
spool show <session>@r3        # Land on record 3
spool show <uuid> --json       # Output as JSON

spool status                   # Show index stats (session count, DB size)

spool projects                 # List projects, grouped across sources
spool projects spool           # List sessions in a project (by name, identity, path, or cwd)
spool projects spool -n 50     # Limit how many sessions are shown
spool projects spool --json    # Output as JSON
```

A project query matches its name, identity key, project display path, or any
session cwd — an exact name wins over partial matches, and ambiguous queries
list the candidates so you can refine.

### Pin

```bash
spool pin <uuid>               # Pin a session to the top of your library
spool unpin <uuid>             # Remove a session from the pinned list
spool pinned                   # List pinned sessions
spool pinned --json            # Output as JSON
```

Pins are shared with the Spool desktop app — pinning here surfaces the
session in the app's library on its next refresh, and vice versa.

### Share & resume

Share a session to [spool.pro](https://spool.pro) and pick it up on
another machine — or someone else's.

```bash
spool login                    # Sign in via browser approval (works over SSH)
spool login --token <t>        # Paste a hub API token instead (CI / scripts)
spool logout                   # Revoke this machine's token + delete local credentials

spool share                    # Share the latest session in the current directory
spool share <uuid>             # Share a specific session (uuid prefixes work)
spool share <uuid>@12          # Share only the first 12 records
spool share -m "note"          # Set the note without opening the editor
spool share --no-edit          # Publish the prefilled draft as-is
spool share --yes              # Skip the secret-findings confirmation

spool resume <sid|url>         # Materialize a shared session and fork it natively
spool resume <sid>@12          # Fork at record 12 (first 12 records only)
spool resume --workspace <dir> # Resume in a specific workspace root
spool resume --no-exec         # Print the native resume command instead of launching

spool withdraw <sid|url>       # Take a shared session down (tombstone)
```

`spool share` scans for secrets before anything leaves the machine and
opens your editor to write a note. `spool resume` writes a brand-new
provider-native session (Claude → `~/.claude/projects`, Codex →
`~/.codex/sessions`) and launches the provider's fork entry point, so
continued work branches off cleanly from the share point.

### Sync

```bash
spool sync                     # Index new AI sessions (Claude, Codex, Gemini, OpenCode, Pi)
spool sync --watch             # Keep watching for new sessions
```

### Doctor

```bash
spool doctor                   # Diagnose your environment, database, and config
spool doctor db.integrity      # Run a single check by id
spool doctor --json            # Machine-readable output
spool doctor --fix             # Apply safe fixes for failing checks
spool doctor --fix --force     # Also apply destructive fixes
```

## Data location

All data is stored locally in `~/.spool/`:
- `spool.db` — SQLite database with sessions and messages
- `hub-credentials.json` — hub URL + API token from `spool login`

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

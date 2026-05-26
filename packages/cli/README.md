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
spool list -s claude -n 10     # Filter by source
spool list --json              # Output as JSON

spool show <uuid>              # Print full session content
spool show <uuid> --json       # Output as JSON

spool status                   # Show index stats (session count, DB size)
```

### Pin

```bash
spool pin <uuid>               # Pin a session to the top of your library
spool unpin <uuid>             # Remove a session from the pinned list
spool pinned                   # List pinned sessions
spool pinned --json            # Output as JSON
```

Pins are shared with the Spool desktop app — pinning here surfaces the
session in the app's library on its next refresh, and vice versa.

### Sync

```bash
spool sync                     # Index new AI sessions (Claude, Codex, Gemini)
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

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

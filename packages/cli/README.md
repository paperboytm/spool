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
spool show <uuid> --json       # Output as JSON

spool status                   # Show index stats (session count, DB size)
```

### Sync

```bash
spool sync                     # Index new AI sessions (Claude, Codex, Gemini, OpenCode)
spool sync --watch             # Keep watching for new sessions
```

## Data location

All data is stored locally in `~/.spool/`:
- `spool.db` — SQLite database with sessions and messages

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

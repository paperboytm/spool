# @spool-lab/core

The engine behind [Spool](https://spool.pro) — a local search engine for your AI sessions.

This package provides the core runtime: session parsing, full-text search, and the SQLite database layer. It powers both the Spool desktop app and the `@spool-lab/cli`.

## Usage

```ts
import { getDB, searchFragments, listRecentSessions, Syncer } from '@spool-lab/core'

const db = getDB()

// Search across all indexed sessions
const results = searchFragments(db, 'authentication middleware', { limit: 10 })

// List recent sessions
const sessions = listRecentSessions(db, 20)

// Sync new sessions from Claude, Codex, Gemini, Antigravity, OpenCode
const syncer = new Syncer(db)
syncer.syncAll()
```

## What's inside

- **Session parsers** — reads Claude Code, Codex, Gemini CLI, Antigravity CLI, and OpenCode sessions
- **Full-text search** — FTS5 with unicode + trigram indexes for CJK support
- **Watcher** — incremental indexing as new session files arrive
- **Stars** — pin sessions for quick recall

## Native dependency

This package depends on [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3), which includes a native C++ addon. On most platforms, prebuilt binaries are downloaded automatically during install. If that fails, you'll need a C++ toolchain (Python 3, node-gyp).

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

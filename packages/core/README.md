# @spool-lab/core

Local Session preparation engine used by the Spool CLI.

This package reads provider Sessions, stores normalized metadata and messages in SQLite, groups Sessions by project, maintains private organization state, and provides local full-text retrieval. Preparation is separate from publishing; Hub transport and public visibility do not live in this package.

## Usage

```ts
import { getDB, listRecentSessions, searchFragments, Syncer } from '@spool-lab/core'

const db = getDB()

const results = searchFragments(db, 'authentication middleware', { limit: 10 })
const sessions = listRecentSessions(db, 20)

const syncer = new Syncer(db)
syncer.syncAll()
```

## Responsibilities

- provider Session loading for Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi
- project grouping across agent sources
- incremental file and database ingestion
- SQLite metadata and message storage
- FTS5 retrieval, including CJK-friendly indexes
- private pins and local organization state
- security-scan storage and maintenance helpers

Browser-safe canonical records, views, and composed Session diffs belong to `@spool-lab/session-kit`.

## Native Dependency

This package depends on [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).
Repository tooling caches the addon by platform, architecture, and Node module ABI. `pnpm spool`
prepares a missing cache automatically.

Manual recovery remains available:

```bash
pnpm run rebuild:native:node
```

## License

MIT

## Trademark

Spool™ is a trademark of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo.

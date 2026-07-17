---
title: Configuration
description: Spool's data paths and agent configuration.
---

Spool stores its data in `~/.spool/`.

## Data directory

| Path | Purpose |
|------|---------|
| `~/.spool/spool.db` | Local search index (SQLite) |
| `~/.spool/agents.json` | Agent and SDK configuration |
| `~/.spool/ui.json` | UI preferences (theme, etc.) |

## Watched directories

Spool watches the following directories for real-time session indexing. These paths are built-in and do not require configuration.

| Agent | Path |
|-------|------|
| Claude Code | `~/.claude/projects/` |
| Claude Code (profiles) | `~/.claude-profiles/*/projects/` |
| Codex CLI | `~/.codex/sessions/` |
| Codex CLI (profiles) | `~/.codex-profiles/*/sessions/` |
| Gemini CLI | `~/.gemini/tmp/*/chats/` |
| OpenCode | `~/.local/share/opencode/opencode.db` |

New sessions become searchable the moment they're written.

## Agent configuration

The `~/.spool/agents.json` file configures which agent Spool uses for AI-powered features:

```json
{
  "defaultAgent": "claude",
  "defaultSearchSort": "relevance"
}
```

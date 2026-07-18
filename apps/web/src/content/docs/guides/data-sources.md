---
title: Session Sources
description: Agent Session sources supported by Spool.
---

Spool prepares Sessions from supported coding agents so an author can choose what to share. Source support differs between local preparation and Hub publishing.

## Support matrix

| Agent       | Local preparation | Hub Share / Resume | Default source location               |
| ----------- | ----------------- | ------------------ | ------------------------------------- |
| Claude Code | Yes               | Yes                | `~/.claude/projects/`                 |
| Codex CLI   | Yes               | Yes                | `~/.codex/sessions/`                  |
| Gemini CLI  | Yes               | Not yet            | `~/.gemini/tmp/*/chats/`              |
| OpenCode    | Yes               | Not yet            | `~/.local/share/opencode/opencode.db` |
| Pi          | Yes               | Not yet            | `~/.pi/agent/sessions/`               |

Claude Code and Codex profile directories are also detected:

```text
~/.claude-profiles/*/projects/
~/.codex-profiles/*/sessions/
```

## Local preparation

Desktop watches supported source locations while it runs. The CLI can trigger the same ingestion explicitly:

```bash
spool sync
spool sync --watch
```

Ingestion does not publish a Session. It makes the Session available for review, organization, search, and an explicit Share action.

## Adding a source

A source must preserve enough provider structure for faithful rendering and, before Hub support is enabled, safe canonical records and native Resume behavior. Source badges are added to public UI only when that source can actually produce the relevant artifact.

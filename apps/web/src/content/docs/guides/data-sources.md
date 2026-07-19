---
title: Session Sources
description: Agent Session sources supported by Spool.
---

Spool prepares Sessions from supported coding agents so an author can choose what to share. Source support differs between local preparation and Hub publishing.

## Support matrix

| Agent       | Local preparation | Hub Share | Native Resume | Default source location               |
| ----------- | ----------------- | --------- | ------------- | ------------------------------------- |
| Claude Code | Yes               | Yes       | Yes           | `~/.claude/projects/`                 |
| Codex CLI   | Yes               | Yes       | Yes           | `~/.codex/sessions/`                  |
| Gemini CLI  | Yes               | Yes       | Not yet       | `~/.gemini/tmp/*/chats/`              |
| OpenCode    | Yes               | Yes       | Not yet       | `~/.local/share/opencode/opencode.db` |
| Pi          | Yes               | Yes       | Not yet       | `~/.pi/agent/sessions/`               |

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

A source must preserve enough indexed conversation structure for faithful rendering and safe canonical records before Hub Share is enabled. Native Resume is a separate capability that additionally requires lossless provider records and a safe materializer. Source badges are added to public UI only when that source can actually produce the relevant artifact.

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
| ZCode       | Yes               | Yes       | Not yet       | `~/.zcode/cli/db/db.sqlite`           |

Claude Code and Codex profile directories are also detected:

```text
~/.claude-profiles/*/projects/
~/.codex-profiles/*/sessions/
```

## Local preparation

Use the CLI to index supported source locations explicitly or keep them up to date with watch mode:

```bash
spool            # refreshes the index before sharing
spool daemon run # stays running and indexes continuously
```

Ingestion does not publish a Session. It makes the Session available for review, organization, search, and an explicit Share action.

## Adding a source

A source must preserve enough indexed conversation structure for faithful rendering and safe content-addressed records before Hub Share is enabled. Native Resume is a separate capability: Spool retains provider JSON bytes, including number lexemes and key order, while replacing local path strings with the reserved `$SPOOL_WS` and `$SPOOL_HOME` portability tokens. A materializer restores paths, changes only the new Session identity fields, and appends explicit continuation lineage. Source badges are added to public UI only when that source can actually produce the relevant artifact.

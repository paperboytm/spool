---
title: Configuration
description: Local data, credentials, and source paths used by Spool.
---

Spool stores local application data under `~/.spool/` by default.

## Data directory

| Path                            | Purpose                                             |
| ------------------------------- | --------------------------------------------------- |
| `~/.spool/spool.db`             | Local Session metadata, messages, search, and state |
| `~/.spool/agents.json`          | Local Agent and ACP configuration                   |
| `~/.spool/ui.json`              | UI preferences                                      |
| `~/.spool/security.json`        | Security-scan preferences                           |
| `~/.spool/hub-credentials.json` | Revocable CLI Hub credential                        |

Override the directory for development or isolated automation:

```bash
SPOOL_DATA_DIR=/some/path npx @spool-lab/cli sync
```

## Source locations

| Agent                | Path                                  |
| -------------------- | ------------------------------------- |
| Claude Code          | `~/.claude/projects/`                 |
| Claude Code profiles | `~/.claude-profiles/*/projects/`      |
| Codex CLI            | `~/.codex/sessions/`                  |
| Codex CLI profiles   | `~/.codex-profiles/*/sessions/`       |
| Gemini CLI           | `~/.gemini/tmp/*/chats/`              |
| OpenCode             | `~/.local/share/opencode/opencode.db` |
| Pi                   | `~/.pi/agent/sessions/`               |

These source locations are built in.

## Hub credentials

`npx @spool-lab/cli login` writes a revocable token to `hub-credentials.json`. `npx @spool-lab/cli logout` asks the Hub to revoke that token and removes the local file. If a machine is lost, revoke its credential from the account surface.

Never commit the Spool data directory or Hub credential file to a repository.

## Publishing boundary

Configuration and local indexing do not expose Sessions. A Session leaves the machine only through an explicit Share flow. Claude Code and Codex CLI Shares are Public in Explore and search by default; providers not yet supported by Explore remain Link-only.

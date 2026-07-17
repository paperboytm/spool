---
title: Agent Integration
description: Use Spool as a search backend for your AI coding agents.
---

Spool ships a `/spool` skill that any ACP-compatible agent can call mid-conversation. The agent searches your local session library and pulls matching fragments back into its context — no copy-paste, no cloud round-trip.

## The `/spool` skill

The skill lives in [`skills/spool/SKILL.md`](https://github.com/spool-lab/spool/blob/main/skills/spool/SKILL.md) in the repo. To use it from Claude Code, copy that file into your project's `.claude/skills/spool/SKILL.md` (or your global `~/.claude/skills/spool/SKILL.md`).

The skill requires the `spool` CLI to be on `PATH`. Install it once:

```bash
npm install -g @spool-lab/cli
```

## Example

Inside a Claude Code conversation:

```
> /spool auth middleware refresh token rotation
```

Claude invokes the skill, runs `spool search` against your local index, and presents the top matches with source attribution (Claude / Codex / Gemini / OpenCode) and session UUIDs. You can ask Claude to load any of them with `spool show <uuid>` for full context.

## How it works

1. The agent invokes `/spool <query>`.
2. The skill shells out to `spool search "<query>" --json --limit 5`.
3. Matching fragments come back with `source`, `project`, `startedAt`, `snippet`, and `uuid`.
4. The agent presents the results and offers to load any session in full.

Inference and search both happen on your machine. Spool's status bar always shows `via ACP · local` while AI mode runs — the same trust signal applies when an agent calls the skill.

## Beyond Claude Code

Any agent that can call a CLI tool can use Spool the same way. The CLI's `--json` flag gives you a stable shape to parse; see [CLI reference](/docs/reference/cli) for the full surface.

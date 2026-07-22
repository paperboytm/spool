---
title: Agent Integration
description: Let a coding agent share, resume, and recall Sessions through Spool.
---

Spool ships a skill for shell-capable coding agents. It lets an agent share the current Session, continue from a Spool URL, or retrieve relevant context from Sessions already indexed on the machine.

## Install the skill

The source lives at [`skills/spool/SKILL.md`](https://github.com/paperboytm/spool/blob/main/skills/spool/SKILL.md).

Place it in the skill directory used by your agent. The agent can run the CLI directly with npx:

```bash
npx @spool-lab/cli doctor
```

No global install is required. If you prefer the shorter `spool` command, install it once with
`npm install -g @spool-lab/cli`.

## Share from an agent

Ask the agent to “share this session to Spool.” The skill:

1. syncs the latest records;
2. selects the current Session;
3. prepares a concise Summary;
4. runs `npx @spool-lab/cli share --visibility-confirmed` without bypassing sensitive-data findings;
5. returns the durable URL.

Claude Code and Codex CLI Sessions are Public by default. Gemini CLI, OpenCode, and Pi Sessions use Link-only URLs until Explore supports them.

## Continue a Spool Session

Give the agent a spool.new Session URL and ask it to continue the work. Legacy spool.pro Session URLs remain supported. The skill routes the URL to:

```bash
npx @spool-lab/cli resume <session-url>
```

Resume creates a new native Session and keeps the source relationship intact.

## Recall prior work

The same skill can search local Sessions when you ask about earlier decisions:

```bash
npx @spool-lab/cli search "refresh token rotation" --json -n 5
npx @spool-lab/cli show <uuid> --diff
npx @spool-lab/cli show <uuid> --log
```

Search results include source, project, time, snippet, and Session identifier. The agent can load only the depth needed for the current question instead of injecting every prior conversation.

## Trust boundary

Local recall stays on the machine. Sharing is a separate explicit action. When a local Agent generates a Summary or synthesized answer, the interface must identify the Agent and show `via ACP · local` where ACP is used.

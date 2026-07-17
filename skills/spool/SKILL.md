---
name: spool
description: Share the current session to the Spool hub via the spool CLI ("share to spool", "publish this session", withdraw a share, or a pasted spool session link) — and recall past AI sessions from inside any agent by searching all Claude Code, Codex, Gemini CLI, OpenCode, and Pi history when the user references past work ("we discussed this", "what did codex do", "find that session where…").
allowed-tools: Bash
---

Spool turns an AI coding session into something you can hand to someone else: **share** publishes a session to the hub as a URL teammates read and fork from any machine. Underneath sits a local index of every session on this machine — claude, codex, gemini, opencode, pi — and the CLI is the whole interface, so **any agent with a shell can recall any other agent's sessions**: a Codex session is searchable from Claude Code, and whatever you find carries into the current conversation as ordinary context.

## Routing

Decide from `$ARGS` and the conversation:

- **share/publish** this (or a specific) session → Share flow
- **withdraw/unpublish** a shared session → `spool withdraw <sid-or-url>`
- a **spool session URL or sid** the user wants to continue → `spool resume <sid-or-url>` (materializes it locally and forks the provider's native session)
- anything else (a topic, a question, "that session where…") → Recall flow

## Preflight

```bash
which spool
```

If missing, tell the user: install with `npm install -g @spool-lab/cli`, then `spool sync` to index sessions. Stop here.

## Share flow

Only **claude** and **codex** sessions can be shared. Sharing publishes the full transcript to the hub and prints a URL.

1. `spool sync` — the session must be indexed, and this picks up the newest turns.
2. Pick the target: inside Claude Code use `$CLAUDE_CODE_SESSION_ID`; in other agents (or if unset) omit the argument to share the most recent session in the current directory, or pass a UUID from `spool list`. `<uuid>@<n>` shares only the first *n* records.
3. Compose the note yourself — 1–3 sentences, intent → outcome — and pass it with `-m` (there is no interactive editor here):

```bash
spool share "$CLAUDE_CODE_SESSION_ID" -m "<summary>" < /dev/null
```

The `< /dev/null` matters: if the redact gate finds secrets it prompts, and an unanswered prompt must abort rather than hang.

4. Outcomes:
   - **`Shared N record(s): <url>`** — give the user the URL; teammates run `spool resume <sid>` to fork it locally.
   - **`Not logged in`** — the user runs `spool login` (browser approval), then retry.
   - **Secret findings, share aborted** — show the user the findings summary and ask; only after an explicit yes, re-run with `--yes`.
   - **`Sharing <source> sessions is not supported yet`** — tell the user only claude and codex sessions are shareable.

## Recall flow

The goal is **cited recall**: your reply answers the question and names the session each claim came from.

### 1. Search

```bash
spool search "<query>" --json -n 5
```

- `-s claude|codex|gemini|opencode|pi` filters by agent, `--since 7d` by time.
- When the user names a project, scope to it instead: `spool projects <name>` lists its sessions (exact name > repo slug > substring).
- Zero hits → run `spool sync` once (indexing is manual; the newest sessions are often missing) and retry with broader terms.

Done when you hold at least one relevant UUID — or you have synced, retried, and can report there is no match.

### 2. Zoom

Pick the cheapest view that answers the question; the full transcript is the most expensive and rarely the right first move:

| Question about the session | Command |
|---|---|
| what happened, step by step | `spool show <uuid> --log` — one line per record |
| what code it changed | `spool show <uuid> --diff` — net diff across the whole session |
| one specific record | `spool show <uuid>@r<n>` — raw record JSON |
| the full conversation | `spool show <uuid>` |

### 3. Use it

Fold what you found into your reply as ordinary context, citing the source per claim — `[codex · 7/15 · parallel-world]`. When the user wants to *continue* that session rather than read it, hand over the native resume command that `spool search` already printed: `claude -r <uuid>`, `codex resume <uuid>`, `pi --session <uuid>`.

## Command reference

| Command | Does |
|---|---|
| `spool sync [--watch]` | index new sessions; `--watch` stays running |
| `spool search <query>` | full-text search; prints native resume commands |
| `spool list` | recent sessions; `-s`/`-p` filter a recent window, so raise `-n` when filtering |
| `spool projects [name]` | project groups, or one project's sessions |
| `spool show <uuid\|sid\|url>` | transcript/summary; `--log` timeline, `--diff` net change, `@r<n>` record |
| `spool pin/unpin/pinned <uuid>` | bookmark sessions — state shared with the Spool app Library |
| `spool status` / `spool doctor [--fix]` | index stats / environment diagnostics |
| `spool login` / `spool logout` | hub auth: browser device flow / revoke + clear |
| `spool share` / `spool withdraw` | publish to the hub / unpublish |
| `spool resume <sid\|url>[@<n>]` | materialize a shared session locally, fork it natively; `--no-exec` prints the command only |

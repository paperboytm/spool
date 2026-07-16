---
name: spool
description: Share the current session to the Spool hub ("share to spool", "publish this session") or search your local Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi session history
allowed-tools: Bash
---

Spool is a local search engine over your AI coding sessions, with an optional hub for sharing them. This skill covers both: **sharing the current session** from inside the conversation, and **searching past sessions**.

## Routing

Decide from `$ARGS` and the conversation:

- The user wants to **share/publish** this (or a specific) session → **Share flow**
- The user wants to **withdraw/unpublish** a shared session → run `spool withdraw <sid-or-url>`
- Anything else (a topic, a question, keywords) → **Search flow**

## Preflight (both flows)

```bash
which spool
```

If not found, tell the user:
> `spool` CLI is not installed. Run: `npm install -g @spool-lab/cli` then `spool sync` to index your sessions.
> Stop here.

## Share flow

Only **claude** and **codex** sessions can be shared. Sharing publishes the **full transcript** to the hub and prints a URL.

1. **Index the latest state** (the session must be in the local index, and this picks up the newest turns):

```bash
spool sync
```

2. **Pick the target session.**

- Inside Claude Code, the current session's UUID is in `$CLAUDE_CODE_SESSION_ID` — use it.
- If it's unset (or the user asked for a different session), omit the argument to share the most recent session in the current directory, or pass a UUID / UUID prefix from `spool list`.

3. **Write the note yourself.** You know what this session was about — compose 1–3 sentences (intent → outcome, notable decisions). Always pass it with `-m`; never let the CLI open `$EDITOR` (there is no interactive editor here).

```bash
spool share "$CLAUDE_CODE_SESSION_ID" -m "<your 1-3 sentence summary>" < /dev/null
```

The `< /dev/null` matters: if the redact gate finds secrets it prompts for confirmation, and an unanswered prompt must abort rather than hang.

4. **Handle the outcome:**

- **Success** — output ends with `Shared N record(s): <url>`. Give the user the URL and mention teammates can run `spool resume <sid>` to continue the session locally.
- **`Not logged in`** — tell the user to run `spool login` (needs a token from the hub), then retry.
- **Secret findings, share aborted** — the output lists detected secrets (API keys, tokens…). Show the user that summary and ask whether to share anyway. Only after an explicit yes, re-run the same command with `--yes` appended.
- **`Sharing <source> sessions is not supported yet`** — only claude and codex sessions can be shared; tell the user.

Options worth knowing:

- `spool share <uuid>@<n>` shares only the first *n* records (prefix share) — for "share just the part up to X".
- `spool withdraw <sid-or-url>` unpublishes; the page then returns "withdrawn".

## Search flow

1. **Run the search**

```bash
spool search "$ARGS" --json --limit 5
```

where `$ARGS` is everything the user passed to `/spool`.

2. **Present the results**

For each result in the JSON array, show:
- **Session title** and date (`startedAt`)
- **Source** (claude, codex, gemini, opencode, or pi) and **project** path
- The **snippet** with highlighted terms (strip `<mark>` / `</mark>` tags for plain display)
- A note of the session UUID

Example format:
```
1. [claude] /code/myproject — 2026-03-20
   "…evaluated the database sharding tradeoffs and reached a decision…"
   UUID: abc123

2. [pi] /code/api — 2026-03-18
   "…the race condition was caused by a shared map write without a mutex…"
   UUID: def456
```

3. **Offer to load a full session**

Ask: "Want to see the full conversation for any of these? I can load it with `spool show <uuid>`."

If the user says yes (or specifies a number/UUID), run:

```bash
spool show <uuid>
```

Include the output as context in your next reply.

## Tips

- `--source claude|codex|gemini|opencode|pi` filters by agent; `--since 7d` limits by time
- Use quotes for exact phrases: `/spool "read replicas"`
- Resume hints: `claude -r <uuid>`, `codex resume <uuid>`, `pi --session <uuid>`
- Run `spool sync` first if results seem stale; `spool status` shows index health

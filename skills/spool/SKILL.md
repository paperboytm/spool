---
name: spool
description: Search your local Claude Code, Codex CLI, Gemini CLI, and OpenCode session history
allowed-tools: Bash
---

Search your thinking with spool — a local search engine over your Claude Code, Codex CLI, Gemini CLI, and OpenCode sessions.

## Steps

1. **Check if spool is installed**

```bash
which spool
```

If the command is not found, tell the user:
> `spool` CLI is not installed. Run: `npm install -g @spool/cli` then `spool sync` to index your sessions.
> Stop here.

2. **Run the search**

```bash
spool search "$ARGS" --json --limit 5
```

where `$ARGS` is everything the user passed to `/spool`.

3. **Present the results**

For each result in the JSON array, show:
- **Session title** and date (`startedAt`)
- **Source** (claude, codex, gemini, or opencode) and **project** path
- The **snippet** with highlighted terms (strip `<mark>` / `</mark>` tags for plain display)
- A note of the session UUID

Example format:
```
1. [claude] /code/myproject — 2026-03-20
   "…evaluated the database sharding tradeoffs and reached a decision…"
   UUID: abc123

2. [opencode] /code/api — 2026-03-18
   "…the race condition was caused by a shared map write without a mutex…"
   UUID: def456
```

4. **Offer to load a full session**

Ask: "Want to see the full conversation for any of these? I can load it with `spool show <uuid>`."

If the user says yes (or specifies a number/UUID), run:

```bash
spool show <uuid>
```

Include the output as context in your next reply.

## Tips

- Add `--source claude`, `--source codex`, `--source gemini`, or `--source opencode` to filter by source
- Add `--since 7d` to limit to the last 7 days
- Use quotes for exact phrases: `/spool "read replicas"`
- Run `spool sync` first if results seem stale

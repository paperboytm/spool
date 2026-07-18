---
name: spool
description: Share the current session and a share-ready Summary to the Spool hub via the spool CLI ("share to spool", "publish this session", withdraw a share, or a pasted spool session link) — and recall past AI sessions from inside any agent by searching all Claude Code, Codex, Gemini CLI, OpenCode, and Pi history when the user references past work ("we discussed this", "what did codex do", "find that session where…").
allowed-tools: Bash
---

Spool turns an AI coding session into something you can hand to someone else: **share** publishes the selected records to the hub as a URL teammates read and fork from any machine. A share can carry a Markdown Summary; in an interactive terminal the CLI can generate one with a detected Claude Code or Codex CLI, while an agent shell should provide its own Summary with `--summary`. Underneath sits a local index of every session on this machine — claude, codex, gemini, opencode, pi — so **any agent with a shell can recall any other agent's sessions**.

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

Only **claude** and **codex** sessions can be shared. Sharing publishes the selected transcript records to the hub and prints a URL.

1. Run `spool sync` so the session and its newest turns are indexed.
2. Pick the target:
   - Inside Claude Code, use `$CLAUDE_CODE_SESSION_ID`.
   - In another agent (or if that variable is unset), omit the session argument to select the latest indexed session whose cwd exactly matches the current directory.
   - For any other session, pass a UUID or unique UUID prefix from `spool list`. `<uuid>@<n>` shares only the first _n_ records.
3. Write a share-ready Markdown Summary from the shared portion of the conversation. Use the session's predominant language and do not expose secrets. Start with a 1–2 sentence overview of the original purpose, then use short localized headings in this order:
   - **Purpose**
   - **Progress** — begin with a compact `Goal → Investigation → Implementation → Validation → Result`-style map, then recount the important stages chronologically, including pivots, failures, and validation.
   - **Highlights** — concrete discoveries, decisions, files, commands, APIs, or tests that matter to the recipient.
   - **Result vs. original goal** — classify it as fully met, partially met, diverged, or unresolved, and say why.
   - **Next steps** only when the session supports them.

   Distinguish completed work from proposals and unresolved items; never invent outcomes.
4. Pass that Summary directly. Agent tool shells are non-interactive, so do not rely on the CLI's post-upload Agent prompt:

```bash
summary="$(cat <<'SPOOL_SUMMARY'
<share-ready Markdown Summary>
SPOOL_SUMMARY
)"

# Inside Claude Code:
spool share "$CLAUDE_CODE_SESSION_ID" --summary "$summary" < /dev/null
```

Outside Claude Code, omit the target: `spool share --summary "$summary" < /dev/null`. For a selected session, put its UUID before `--summary`. Add `--spool-file <path>` only when the user wants to attach a `.spool` document.

The `< /dev/null` is deliberate: if the secret gate needs confirmation, a non-interactive invocation must abort instead of hanging. Do not add `--yes` until the user explicitly accepts the reported risk.

5. Handle outcomes:
   - **`Ready to share: <url>`** — the records and provided Summary are live; give the user the URL. Teammates run `spool resume <sid-or-url>` to fork it locally.
   - **`Not logged in`** — ask the user to run `spool login` (browser approval), then retry.
   - **Secret findings / `Cannot confirm ... without a TTY`** — show the findings summary and ask. Only after an explicit yes, re-run the same command with `--yes`.
   - **`Sharing <source> sessions is not supported yet`** — explain that only Claude and Codex sessions are shareable.
   - **`The session is already shared at <url>. Its previous Summary is unchanged.`** — preserve and report the live URL, and explain that only the Summary generation/upload failed.

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

| Question about the session  | Command                                                        |
| --------------------------- | -------------------------------------------------------------- |
| what happened, step by step | `spool show <uuid> --log` — one line per record                |
| what code it changed        | `spool show <uuid> --diff` — net diff across the whole session |
| one specific record         | `spool show <uuid>@r<n>` — pretty-printed record JSON           |
| the full conversation       | `spool show <uuid>`                                            |

For local Gemini, OpenCode, and Pi sessions, use the full transcript: record-level `--log`, `--diff`, and `@r<n>` views currently require Claude or Codex raw records. Local UUID prefixes are accepted when unique.

### 3. Use it

Fold what you found into your reply as ordinary context, citing the source per claim — `[codex · 7/15 · parallel-world]`. When the user wants to _continue_ a local session rather than read it, use the native command shown by human-formatted search output: `claude -r <uuid>`, `codex resume <uuid>`, or `pi --session <uuid>`. JSON search output does not add that command, and the CLI currently prints no resume hint for Gemini or OpenCode.

## Command reference

| Command                                                  | Does                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `spool sync [--watch]`                                   | Index new sessions; `--watch` stays running                                                                      |
| `spool search <query> [-s <source>] [--since 7d]`        | Full-text search; add `--json` for machine-readable results                                                      |
| `spool list [-s <source>] [-p <path>] [-n <count>]`      | Recent sessions; filters apply to a recent window, so raise `-n` when filtering                                  |
| `spool projects [query] [-n <count>]`                    | Project groups, or sessions for a name, identity key, path, or cwd                                               |
| `spool show <uuid\|sid\|url>`                            | Local transcript / shared Summary; `--log` timeline, `--diff` net change, `@r<n>` record, `--json` structured data |
| `spool pin <uuid>` / `unpin <uuid>` / `pinned`           | Bookmark and list sessions; state is shared with the Spool app Library                                           |
| `spool status` / `spool doctor [checkId] [--fix]`        | Index stats / diagnostics; `doctor --fix --force` also permits destructive fixes                                 |
| `spool login [--token <t>]` / `spool logout`             | Hub browser-device auth (or token for automation) / revoke and clear credentials                                 |
| `spool share [<uuid>[@<n>]] [--summary <markdown>]`      | Publish selected Claude/Codex records; also supports `--no-agent-summary`, `--yes`, and `--spool-file`            |
| `spool withdraw <sid\|url>`                              | Tombstone a share so its URL stops resolving                                                                     |
| `spool resume <sid\|url>[@<n>] [--workspace <dir>]`      | Materialize and natively fork a share; `--no-exec` prints the command without launching                          |

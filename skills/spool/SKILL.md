---
name: spool
description: Share the current session and a share-ready Summary to the Spool hub via the spool CLI ("share to spool", "publish this session", withdraw a share, or a pasted spool session link) — and recall past AI sessions from inside any agent by searching all Claude Code, Codex, Gemini CLI, OpenCode, and Pi history when the user references past work ("we discussed this", "what did codex do", "find that session where…").
allowed-tools: Bash
---

Spool is the publishing platform for agent Sessions. **Share** explicitly sends the selected records to the Hub and returns a durable URL. Claude Code and Codex CLI Shares are Public by default and can appear in Explore and search; Gemini CLI, OpenCode, and Pi remain Link-only until Discovery supports them. Claude Code and Codex CLI shares can also be resumed from another machine. A Share can carry a Markdown Summary: the interactive CLI can generate one with a detected Claude Code or Codex CLI, while an agent shell should provide its own Summary with `--summary`. Local preparation and sharing cover all five providers, so **any agent with a shell can recall another agent's Sessions**.

## Routing

Decide from `$ARGS` and the conversation:

- **share/publish** this (or a specific) session → Share flow
- **withdraw/unpublish** a shared session → `spool withdraw <sid-or-url>`
- a resumable **Claude/Codex spool session URL or sid** the user wants to continue → `spool resume <sid-or-url>` (materializes it locally and forks the provider's native session)
- anything else (a topic, a question, "that session where…") → Recall flow

## Preflight

Use the installed `spool …` command for every Spool action. First run `command -v spool`. If it is
missing, install the CLI once, then verify it with `spool --version`:

```bash
curl -fsSL https://spool.new/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
spool --version
```

Do not fall back to npx: a temporary package invocation does not make the `spool` command available
for the later login, Share, or Resume step. For a person sharing the current project, bare `spool` is
the everyday flow: it refreshes the index, signs in if needed, and starts a Share for the latest
Session. This skill uses explicit commands because its non-interactive Share passes a prepared Summary.

## Share flow

**claude**, **codex**, **gemini**, **opencode**, **pi**, and **zcode** sessions can be shared. Sharing sends native Claude/Codex records or the other sources' provider-neutral indexed conversation to the Hub. The CLI states the resulting visibility before upload and then prints the durable URL.

1. Run bare `spool` (or rely on a running `spool daemon`) so the session and its newest turns are indexed.
2. Pick the target:
   - Inside Claude Code, use `$CLAUDE_CODE_SESSION_ID`.
   - In another agent (or if that variable is unset), omit the session argument to select the latest indexed session whose cwd exactly matches the current directory.
   - For any other session, pass a UUID or unique UUID prefix from `spool sessions list`. `<uuid>@<n>` shares only the first _n_ records.
3. Write a share-ready Markdown Summary from the shared portion of the conversation. It should read like a concise, polished GitHub README for this one session—not a turn-by-turn chat recap.

   Determine the language from the session's natural-language conversation, giving substantive user messages more weight than assistant replies. Ignore code, logs, commands, paths, identifiers, metadata, and pasted material when deciding. For a mixed-language session, use the dominant language of the user's discussion; if none is clear, use the first substantive user request. Use that language for all prose and headings while preserving technical names in their original form.

   Use this README-style structure, localizing every heading:
   - `# <specific title>` derived from the actual goal, followed by a 1–2 sentence overview.
   - `## Goal` — the original request, constraints, and meaningful scope changes.
   - `## What happened` — the important stages in chronological order, grouped into concise paragraphs or bullets; include relevant pivots, failures, implementation details, and validation.
   - `## Key decisions and findings` only when material decisions or discoveries shaped the work.
   - `## Validation` only when the session contains concrete checks, tests, builds, or measurements.
   - `## Outcome` — state whether the goal was achieved, partially achieved, changed, or remains unresolved, and explain why.
   - `## Next steps` only when the session supports specific remaining work.

   Omit optional sections without meaningful content. Use direct, neutral language, preserve useful technical details, distinguish completed work from proposals and unresolved items, do not expose secrets, and never invent outcomes.

4. Pass that Summary directly. Agent tool shells are non-interactive, so do not rely on the CLI's post-upload Agent prompt:

```bash
summary="$(cat <<'SPOOL_SUMMARY'
<share-ready Markdown Summary>
SPOOL_SUMMARY
)"

# Inside Claude Code:
spool share "$CLAUDE_CODE_SESSION_ID" --summary "$summary" --visibility-confirmed < /dev/null
```

Outside Claude Code, omit the target: `spool share --summary "$summary" --visibility-confirmed < /dev/null`. For a selected session, put its UUID before `--summary`. Add `--spool-file <path>` only when the user wants to attach a `.spool` document. `--visibility-confirmed` acknowledges the stated Public/Link-only result but does not bypass sensitive-data findings.

The `< /dev/null` is deliberate: if the secret gate needs confirmation, a non-interactive invocation must abort instead of hanging. Do not add `--yes` until the user explicitly accepts the reported risk.

5. Handle outcomes:
   - **`Session published`** — a Claude/Codex Session and its provided Summary are Public and can appear in Explore and search; give the user the URL. Teammates can run `spool resume <sid-or-url>` to fork it locally.
   - **`Session shared as Link-only`** — a Gemini/OpenCode/Pi Session and its provided Summary are live for anyone with the URL, but do not appear in Explore or search.
   - **`Not logged in`** — ask the user to run `spool login` (browser approval), then retry.
   - **Secret findings / `Cannot confirm ... without a TTY`** — show the findings summary and ask. Only after an explicit yes, re-run the same command with `--yes`.
   - **`<source> sessions can be shared and read, but native Resume is not supported yet`** — explain that the share is readable, while native Resume currently requires Claude or Codex.
   - **`The session is already shared at <url>. Its previous Summary is unchanged.`** — preserve and report the live URL, and explain that only the Summary generation/upload failed.

## Recall flow

The goal is **cited recall**: your reply answers the question and names the session each claim came from.

### 1. Search

```bash
spool sessions search "<query>" --json -n 5
```

- `-s claude|codex|gemini|opencode|pi|zcode` filters by agent, `--since 7d` by time.
- When the user names a project, scope to it instead: `spool sessions list -p <path>` lists sessions for a project path.
- Zero hits → run bare `spool` once (the newest sessions may not be indexed yet) and retry with broader terms.

Done when you hold at least one relevant UUID — or you have synced, retried, and can report there is no match.

### 2. Zoom

Pick the cheapest view that answers the question; the full transcript is the most expensive and rarely the right first move:

| Question about the session  | Command                                                                 |
| --------------------------- | ----------------------------------------------------------------------- |
| what happened, step by step | `spool sessions show <uuid> --log` — one line per record                |
| what code it changed        | `spool sessions show <uuid> --diff` — net diff across the whole session |
| one specific record         | `spool sessions show <uuid>@r<n>` — pretty-printed record JSON          |
| the full conversation       | `spool sessions show <uuid>`                                            |

For local Gemini, OpenCode, and Pi sessions, use the full transcript: record-level `--log`, `--diff`, and `@r<n>` views currently require Claude or Codex raw records. Local UUID prefixes are accepted when unique.

### 3. Use it

Fold what you found into your reply as ordinary context, citing the source per claim — `[codex · 7/15 · parallel-world]`. When the user wants to _continue_ a local session rather than read it, use the native command shown by human-formatted search output: `claude -r <uuid>`, `codex resume <uuid>`, or `pi --session <uuid>`. JSON search output does not add that command, and the CLI currently prints no resume hint for Gemini, OpenCode, or ZCode.

## Command reference

| Command                                                           | Does                                                                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spool`                                                           | Refresh the current project, sign in if needed, and start a Share for its latest Session                                                                                |
| `spool subscribe [dir] [--team <t>\|--link-only\|--public]`       | One-time disclosure decision; the directory (and its worktrees) then auto-publishes on every pass                                                                       |
| `spool daemon start\|stop\|status\|logs\|run`                     | Always-on watcher + auto-publisher registered with launchd/systemd                                                                                                      |
| `spool sessions search <query> [-s <source>] [--since 7d]`        | Full-text search; add `--json` for machine-readable results                                                                                                             |
| `spool sessions list [-s <src>] [-p <path>] [-n <count>] [--all]` | Current-project Sessions by default; `--all` searches every project. Filters apply to a recent window, so raise `-n` when filtering                                     |
| `spool sessions show <uuid\|sid\|url>`                            | Local transcript / shared Summary; `--log` timeline, `--diff` net change, `@r<n>` record, `--json` structured data                                                      |
| `spool doctor [checkId] [--fix]`                                  | Diagnostics incl. index stats and daemon heartbeat; `--fix --force` also permits destructive fixes                                                                      |
| `spool login [--token <t>]` / `spool logout`                      | Hub browser-device auth (or token for automation) / revoke and clear credentials                                                                                        |
| `spool share [<uuid>[@<n>]] [--summary <markdown>]`               | Publish Claude/Codex publicly by default; share other providers as Link-only. Also supports `--visibility-confirmed`, `--no-agent-summary`, `--yes`, and `--spool-file` |
| `spool visibility <sid\|url> <public\|link-only\|team>`           | Named, confirmed disclosure change; Team → Public keeps Team ownership                                                                                                  |
| `spool withdraw <sid\|url>`                                       | Tombstone a share so its URL stops resolving                                                                                                                            |
| `spool resume <sid\|url>[@<n>] [--workspace <dir>]`               | Materialize and natively fork a Claude/Codex share; `--no-exec` prints the command without launching                                                                    |

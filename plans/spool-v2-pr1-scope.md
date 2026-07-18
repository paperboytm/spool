# Spool v2 — PR 1 "walking skeleton" scope contract

> Binding scope for the first v2 PR. Where this file and the design docs disagree, **this file wins for PR 1**.
> Design context (read first): `docs/spool-v2-design.zh-CN.md`, `plans/spool-v2-implementation.zh-CN.md`, `plans/spool-v2-hub-web.zh-CN.md`.

## Goal

One PR that makes the full v2 share flow run end-to-end:

```
local provider session ─ spool share ─→ hub (/api/hub/v1) ─→ web page /session/:sid
                                                        └─→ spool resume <url> (claude)
```

v1 stays untouched: existing CLI commands, `/api/publish` snapshot share, `/s/:id` pages all keep working. No opportunistic refactors outside the listed surface.

## In scope / out of scope

| In (PR 1)                                                                  | Out (follow-ups)                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| New pkg `packages/session-kit` (browser-safe core logic)                   | Persistent local store (`store.db`) — records are computed at share time |
| Hub endpoints under `/api/hub/v1/*` in share-backend                       | Ed25519 signature **verification** (wire carries `sig: null`)            |
| CLI: `login`, `share` (incl. `@<n>` prefix), `resume` (claude), `withdraw` | `resume` for codex; gemini/opencode everywhere                           |
| Web reader `/session/:sid` (3 layers) + router route                       | OG **image** (meta tags only), editor gutter, Trace/blame/why            |
| Hermetic round-trip integration test                                       | Playwright e2e for the reader (document the gap in PR body)              |

## Identifiers & crypto (binding wire spec)

- `oid` = lowercase hex SHA-256 of the canonical record bytes (UTF-8). Use WebCrypto (`crypto.subtle`) — must run in browser, Workers, Node ≥ 20.
- Canonicalization: parse the raw JSONL line, re-serialize JCS-style (recursively sorted object keys, no insignificant whitespace, UTF-8), then rewrite paths: every occurrence of the workspace root string → `$SPOOL_WS`, of the user home dir → `$SPOOL_HOME`. Hash _after_ rewriting, so OIDs are machine-independent.
- Sequence chain: `node_i = sha256(raw(node_{i-1}) || raw(oid_i))` over raw 32-byte digests, `node_{-1}` = 32 zero bytes. `root(n) = hex(node_{n-1})`. Prefix share `@n` = push head at position `n`.
- `sid` = `<provider>_<provider-session-uuid>`, provider ∈ `claude | codex` (e.g. `claude_6f9a…`). Share URL: `https://spool.pro/session/<sid>`.

## Hub API (share-backend, Cloudflare Pages Functions)

Write path (auth: `Authorization: Bearer <token>`):

```
POST /api/hub/v1/sessions/:sid/push
  { root, count, manifest: [oid…], sig: null, cardJson, noteMd, lineageJson, viewOid }
  → 200 { missing: [oid…] }          // per-user dedup; server verifies fold(manifest) == root
POST /api/hub/v1/objects/batch        // NDJSON lines: { oid, data }  (data = canonical string)
  → 200 { stored: n }                // server re-hashes each line, rejects mismatches
POST /api/hub/v1/sessions/:sid/head   // same body as push; commits atomically once nothing is missing
  → 200 { url }
POST /api/hub/v1/sessions/:sid/withdraw → 200   (owner only; tombstone, objects retained)
POST /api/hub/v1/tokens               // cookie-session auth (existing web sign-in) → { token }
```

Read path (public for `visibility='unlisted'`, no auth):

```
GET /api/hub/v1/sessions/:sid          → head meta + author {handle, displayName, avatarUrl}
                                          404 unknown/private · 410 withdrawn (tombstone body)
                                          Cache-Control: no-store
GET /api/hub/v1/sessions/:sid/view     → view object JSON        (ETag: viewOid, max-age=3600)
GET /api/hub/v1/sessions/:sid/records?from=0&to=200
                                       → NDJSON lines { i, oid, data }; clamp to record_count;
                                          ≤500 records / ≤8 MB per request; ETag root+range, max-age=3600
```

Storage:

- New R2 binding `HUB`. Keys: `packs/<userId>/<pushId>` (uncompressed concatenated record bytes — ranged GETs must work), `manifests/<root>` (NDJSON of oids, written at head commit).
- D1 migration `0003_hub.sql`:
  - `hub_sessions(sid PK, owner_user_id, root, record_count, sig, card_json, note_md, lineage_json, view_oid, visibility DEFAULT 'unlisted', withdrawn_at, created_at, updated_at)`
  - `hub_objects(owner_user_id, oid, size, pack_key, offset, length, created_at, PRIMARY KEY(owner_user_id, oid))` — **dedup is per-user by design** (anti dedup-oracle)
  - `api_tokens(id PK, user_id, token_hash, label, created_at, last_used_at)` — store SHA-256 of token
- The view object is uploaded through `objects/batch` like any object (it is content-addressed, not part of the sequence); reads resolve it via `hub_objects` + ranged GET.
- Quotas: per-push ≤ 100 MB; reject records endpoint ranges outside limits with 400.
- Dev convenience: if env `HUB_DEV_TOKEN` is set (local dev only), accept it as a valid bearer token for a synthetic dev user.

## View object (`v: 1`, derived deterministically by session-kit)

```jsonc
{ "v": 1,
  "index":   [{ "i", "kind": "user|assistant|tool|edit|other", "ts"?, "size", "file"?, "tool"?, "excerpt"? }],
  "files":   [{ "path", "events": [recordIdx…], "adds", "dels" }],
  "outline": [{ "i", "excerpt" }],                 // user prompts
  "firstPrompt": "…≤4 KB…", "lastReply": "…≤4 KB…",
  "diffstat": { "files", "adds", "dels" } }
```

Size cap 8 MB. Authors compute it; readers can recompute — the diff pane always recomputes from records, so a tampered view is visible.

## session-kit exports (consumed by cli, share-backend tests, share-web)

`splitRecords`, `canonicalizeRecord`, `sequenceRoot`/`chainRoots`, `extractEditEvents` (claude Edit/Write/MultiEdit/NotebookEdit tool_use + successful tool_result pairing; codex apply_patch), `deriveView`, `composeSessionDiff` (per-file net diff, hunk ↔ record-idx mapping), shared types. Zero runtime deps preferred (a small pure-JS diff lib is acceptable). ESM, no `node:` imports in runtime code. Test fixtures must be **synthetic** — never copy real transcripts.

## CLI (packages/cli)

- `spool login [--token <t>]` — paste/flag an API token; store `{ hubUrl, token }` in `~/.spool/hub-credentials.json`. `SPOOL_HUB_URL` / `SPOOL_HUB_TOKEN` env override (local dev: `http://127.0.0.1:8788`).
- `spool share [<session-id>][@<n>] [--summary <markdown>] [--no-agent-summary] [--yes]` — resolve session via the existing core index; run the session-kit pipeline and **redact gate**; publish through the 3-step handshake first; then, in a TTY, detect installed Claude Code/Codex CLIs and use Clack to offer/select one for local Summary generation; automatically advance the same head with the generated Summary. `--summary` is an advanced bypass, and `--no-agent-summary` suppresses the offer.
- `spool resume <url|sid>[@<n>] [--workspace <dir>] [--exec]` — claude only in PR 1: fetch meta+records, map `$SPOOL_WS` → local workspace root (default cwd), write a **new** provider-native JSONL under `~/.claude/projects/…` with a fresh UUID (rewrite per-line sessionId, preserve uuid/parentUuid chains; study `insertSpoolAuthoredSession` + `spool-prelude.ts` precedent), append one clearly-marked Spool birth record (source URL, author, @position, workspace card, agent hint), then print `claude --resume <uuid>` (spawn it only with `--exec`).
- `spool withdraw <sid|url>`.

## Web (share-web + router)

- SPA route `/session/:sid` → `SessionReader`: **Layer 1** first screen (Markdown Summary vs machine-evidence zones, file list, outline, status, copyable resume command; fallback chain Summary → lastReply → firstPrompt+lastReply); **Layer 2** timeline (virtualized, windowed record-range fetching, per-kind renderers, render-truncate huge records) ↔ per-file lazy diff pane (`composeSessionDiff` client-side, hunk ↔ tool-call two-way linking); **Layer 3** `#r/<idx>` deep link (fetch neighborhood, expand, scroll).
- `functions/session/[sid].ts`: server-side OG/Twitter **meta tags only** (title from Summary first line → first-prompt excerpt fallback), following the existing `functions/s/[id].ts` pattern.
- `workers/spool-pro-router`: route `/session/*` → share-web.
- Follow `DESIGN.md` strictly (warm amber accent, Geist Mono for record content/paths/commands, no blue/purple). Reader metadata is **author-attributed** (`@handle · shared 2h ago`) — the first-person rule applies to the owner's own library, not to share pages.

## Testing gates (per repo test discipline)

1. session-kit: vitest goldens (canonicalization, chain, edit-event extraction, view, diff) incl. truncation/rewrite edge cases.
2. share-backend: hermetic tests for every endpoint (extend R2 fake with ranged GET), incl. tombstone-410, clamp, per-user dedup, bad-hash rejection, quota.
3. Round-trip integration (hermetic, in share-backend tests): synthetic claude fixture → session-kit client → push/batch/head handlers → read endpoints → client recomputes diff == author-side diff.
4. CLI: vitest with mocked fetch for the handshake; resume materialization golden (fixture in temp HOME).
5. Root `pnpm typecheck` + `pnpm lint` + affected package tests green. App e2e untouched (no app changes allowed).

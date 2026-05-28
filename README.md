# Spool

Your local AI session library.

<p align="center">
  <img src="docs/spool-v1.png" alt="Spool" width="720">
</p>

Spool collects every Claude Code, Codex CLI, Gemini CLI, and OpenCode session you've ever had into a sidebar of projects you can browse, pin, and revisit. Press ⌘K to search across the whole archive.

> **Early stage.** Spool is under active development — expect rough edges. Feedback, bug reports, and ideas are very welcome via [Issues](https://github.com/paperboytm/spool/issues) or [Discord](https://discord.gg/aqeDxQUs5E).

## Install

```bash
curl -fsSL https://spool.pro/install.sh | bash
```

Or grab the prebuilt DMG (macOS arm64) / AppImage (Linux x86_64) directly from the [Releases page](https://github.com/paperboytm/spool/releases/latest). Or build from source:

```bash
pnpm install
pnpm build
# DMG is in packages/app/dist/
```

## What it does

Spool turns the pile of AI sessions sitting on your disk into a browsable library.

- **Library shell** — sidebar of projects (derived from working-dir paths across agents) and a main pane that shows recent + pinned sessions for whatever you've selected
- **Session indexing** — watches Claude/Codex/Gemini session dirs and OpenCode's SQLite database in real time, including profile-based paths like `~/.claude-profiles/*/projects`, `~/.codex-profiles/*/sessions`, Gemini's project temp dirs under `~/.gemini/tmp/*/chats`, and `~/.local/share/opencode/opencode.db`
- **Pin** — keep important sessions on top of their project and on the global Library Home
- **⌘K search** — fast full-text search scoped to All or the current project; AI mode synthesizes answers across fragments
- **Agent search** — a `/spool` skill inside Claude Code (and any ACP agent) feeds matching fragments back into your conversation
- **Security Scan** (default on, v0.5.0+) — always-on local scanner surfaces leaked API keys, tokens, and PII across every session; one-click rotate-at-source for major vendors, cross-session blast radius, and "purge everywhere" to wipe a value from your archive

Everything stays on your machine. Nothing leaves.

> Looking for connectors (Twitter / GitHub / Reddit / etc.)? They now live in **[Spool Daemon](https://spool.pro/daemon)**, a sibling app focused on syncing platform data.

## Architecture

```
packages/
  app/      Electron app (React + Vite + Tailwind) — macOS + Linux
  core/     Indexing engine (SQLite + FTS5)
  cli/      CLI interface (`spool search ...`)
  redact/   Secret-detection regex library (published as @spool-lab/redact)
  landing/  spool.pro website
```

## Development

```bash
pnpm install
pnpm exec electron-rebuild -f -w better-sqlite3   # rebuild native modules for Electron
pnpm dev          # starts app + landing in dev mode
pnpm test         # runs all tests
```

> **Note:** The `electron-rebuild` step is required whenever you run `pnpm install` or switch Node.js versions. Without it, the Electron app will crash at launch with a `NODE_MODULE_VERSION` mismatch error from `better-sqlite3`.

If you switch between **Node-side tests** and **Electron app/e2e runs**, rebuild `better-sqlite3` for the matching runtime:

```bash
pnpm run rebuild:native:node      # before @spool/core / Node-based tests
pnpm run rebuild:native:electron  # before launching the Electron app or e2e tests
```

### Dev DB isolation

`pnpm dev` points Spool at `~/.spool-dev/` instead of your real `~/.spool/`,
so iterating on schema migrations or destructive maintenance never touches the
database you actually use. The dev DB starts empty; seed it from your real one
only when you want realistic data:

```bash
pnpm --filter @spool/app dev:seed-from-prod   # copies ~/.spool/ → ~/.spool-dev/
pnpm --filter @spool/app dev:reset-db         # wipes ~/.spool-dev/
```

Override the dev location with `SPOOL_DATA_DIR=/some/path pnpm dev`. The
isolation kicks in automatically in dev mode; production builds always use the
real `~/.spool/`.

## Release

```bash
./scripts/release.sh        # bump version, push tag, dispatch CI release workflow
```

Build + signing happen in GitHub Actions (see `.github/workflows/release.yml`) so
releases are never tied to a local developer certificate. The script blocks
until CI finishes; artifacts appear on the release page when it returns.

To test a local build without cutting a release, use `pnpm --filter @spool/app build:mac`.

## License

MIT

## Trademark

"Spool" and the Spool logo are trademarks of TypeSafe Limited. The MIT License above covers the source code only and does not grant permission to use the Spool name or logo. See the trademark notice in [LICENSE](LICENSE) for details.

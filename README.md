# Spool

Publish, discover, and continue agent sessions.

Spool turns work done with coding agents into durable web pages that other people can understand and resume. An author shares a real Session—not a screenshot or reconstructed recap—and readers can move from Summary to conversation, tool activity, files, and diff before continuing the work in their own agent.

> **Early stage.** Link-only sharing works for Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi. Native Resume currently works for Claude Code and Codex CLI. Feedback is welcome through [Issues](https://github.com/spool-lab/spool/issues) or [Discord](https://discord.gg/aqeDxQUs5E).

## Install

### Desktop

```bash
curl -fsSL https://spool.pro/install.sh | bash
```

The desktop app currently supports macOS on Apple Silicon. Release artifacts are also available from the [latest GitHub release](https://github.com/spool-lab/spool/releases/latest).

### CLI

```bash
npm install -g @spool-lab/cli
```

## Share a Session

From the desktop app, open an indexed Session and choose **Share session**.

From a terminal:

```bash
spool sync
spool login
spool share <session-uuid>
```

Spool scans the selected Session for sensitive values, prepares an optional Summary, publishes the records to the Hub, and returns a durable URL.

A reader can open that URL without installing Spool. Claude Code and Codex CLI shares can also be continued locally:

```bash
spool resume <session-url>
```

Resume creates a new provider-native Session and preserves its relationship to the source. The shared source is never modified.

## Product Model

- **Share** creates a durable Link-only URL.
- **Publish** makes a Shared Session Public so it can appear on the author’s Profile and in Discovery.
- **Read** moves from Summary to conversation, tools, files, and net diff.
- **Resume / Fork** creates new agent-native work with visible lineage.
- **Withdraw** removes access to a Shared Session.

Nothing is published automatically. A new share is Link-only; public visibility is always a separate, explicit choice.

## What Spool Includes

- **Session publishing** — share Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions from Desktop or CLI
- **Readable Session pages** — Summary, conversation, tool activity, touched files, diff, and record deep links
- **Native continuation** — materialize Claude Code and Codex CLI shares locally and continue them in their original agent format
- **Sensitive-data checks** — detect likely credentials, tokens, personal data, and local paths before sharing
- **Local preparation** — collect and organize Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions before deciding what to share
- **Agent access** — use the bundled Spool skill or JSON CLI output from any shell-capable agent
- **Public identity and Discovery** — Profiles, Public Sessions, topics, and continuation lineage are the community layer under active development

## Architecture

```text
apps/
  app/          Electron desktop app for preparing, reading, and sharing Sessions
  cli/          CLI for indexing, sharing, reading, resuming, and automation
  web/          spool.pro: homepage, docs, Profiles, account pages, and Session reader
  backend/      Hub, identity, publication, and media API on Cloudflare
packages/
  core/         Local Session ingestion, organization, SQLite, and full-text search
  redact/       Sensitive-data detection shared by publishing surfaces
  session-kit/  Browser-safe Session model, canonical records, views, and diffs
  session-view/ Shared conversation renderer for Desktop and Web
  share-kit/    Curated `.spool` documents, templates, and export primitives
```

The original provider Session remains authoritative. Git remains authoritative for code. Spool publishes agent work and its context; it does not replace the project’s source-control system.

## Development

```bash
pnpm install
pnpm exec electron-rebuild -f -w better-sqlite3
pnpm dev
```

Run the standard checks with:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Do not run desktop end-to-end tests unless the task specifically requires them.

### Native runtime switching

`better-sqlite3` must match the active runtime:

```bash
pnpm run rebuild:native:node      # Node tests and CLI work
pnpm run rebuild:native:electron  # Electron development and packaging
```

### Development data

Desktop development uses `~/.spool-dev/` instead of the production data directory.

```bash
pnpm --filter @spool/app dev:seed-from-prod
pnpm --filter @spool/app dev:reset-db
```

Override it with `SPOOL_DATA_DIR=/some/path pnpm dev`.

## Release

```bash
./scripts/release.sh
```

Build and signing run in GitHub Actions. For a local macOS package without a release:

```bash
pnpm run package:mac
```

## License

MIT

## Trademark

“Spool” and the Spool logo are trademarks of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo. See [LICENSE](LICENSE).

# Spool

Share, read, and continue agent sessions.

Spool turns work done with coding agents into durable web pages that other people can understand and resume. An author shares a real Session—not a screenshot or reconstructed recap—and readers can move from Summary to conversation, tool activity, files, and diff before continuing the work in their own agent.

> **Early stage.** Claude Code and Codex CLI shares are Public by default and can appear in Explore and search. Gemini CLI, OpenCode, and Pi shares remain Link-only until Discovery supports them. Signed-in authors can move a Session into a Team, making it Team-only for current members, or let Team Owners and Admins publish the Team-owned asset more broadly. Native Resume currently works for Claude Code and Codex CLI. Feedback is welcome through [Issues](https://github.com/spool-lab/spool/issues) or [Discord](https://discord.gg/aqeDxQUs5E).

## Install the CLI

```bash
curl -fsSL https://spool.new/install.sh | sh
```

Install once, open a new terminal, then use `spool` from any project.

## Share a Session

```bash
cd /path/to/project
spool
```

Bare `spool` refreshes the local index, signs in through the browser if needed, and selects the latest Session in the current project. It then shows what will be shared, scans for sensitive values, confirms the resulting visibility, publishes the records to the Hub, and returns a durable URL.

Use the explicit form when you want to choose a Session or pass sharing options:

```bash
spool share <session-uuid>
```

A reader can open that URL without installing Spool. Claude Code and Codex CLI shares can also be continued locally:

```bash
spool resume <session-url>
```

Resume creates a new provider-native Session and preserves its relationship to the source. The shared source is never modified.

## Product Model

- **Share** is the explicit action that sends selected Session records to the Hub and returns a durable URL.
- **Publish** is the default result for supported Claude Code and Codex CLI Shares: a Public Session that can appear on the author’s Profile, in Explore, and in search.
- **Team** is a role-based workspace. Moving a Session into one transfers control of the hosted asset to the Team; `Team · name` limits reading to current members, while Team Owners and Admins can change disclosure.
- **Read** moves from Summary to conversation, tools, files, and net diff.
- **Resume / Fork** creates new agent-native work with visible lineage.
- **Withdraw** makes the current hosted copy return `410 Gone`. A personal author can later explicitly Share the same Session again; a Team-owned withdrawal by an Owner/Admin is permanent and cannot be revived by another member.

Nothing leaves the machine until the author confirms the Share flow started by `spool` or `spool share`. The confirmation states the initial visibility before upload: supported Claude Code and Codex CLI Sessions are Public by default; other providers remain Link-only. After Share, the account page can move a Session to `Team · name`; Team-only access requires current membership.

## What Spool Includes

- **Session sharing** — publish Claude Code and Codex CLI Sessions publicly by default, with Link-only fallback for Gemini CLI, OpenCode, and Pi
- **Readable Session pages** — Summary, conversation, tool activity, touched files, diff, and record deep links
- **Native continuation** — materialize Claude Code and Codex CLI shares locally and continue them in their original agent format
- **Sensitive-data checks** — detect likely credentials, tokens, personal data, and local paths before sharing
- **Local preparation** — collect and organize Claude Code, Codex CLI, Gemini CLI, OpenCode, and Pi Sessions before deciding what to share
- **Agent access** — use the bundled Spool skill or JSON CLI output from any shell-capable agent
- **Public identity and Discovery** — author Profiles, Explore/search, Public Sessions, and continuation lineage
- **Team workspaces** — Owner, Admin, and Member roles; invitations; member-only Sessions; and explicit disclosure controls

## Share Stack

The current Share-focused surfaces are:

```text
apps/
  cli/          CLI for indexing, sharing, reading, resuming, and automation
  web/          spool.new: homepage, docs, Profiles, account/Team pages, and Session reader
  backend/      Hub, identity, Teams, publication, and media API on Cloudflare
packages/
  core/         Local Session ingestion, organization, SQLite, and full-text search
  redact/       Sensitive-data detection shared by publishing surfaces
  session-kit/  Browser-safe Session model, canonical records, views, and diffs
  session-view/ Shared conversation renderer for Session pages
  share-kit/    Curated `.spool` documents, templates, and export primitives
```

The original provider Session remains authoritative. Git remains authoritative for code. Spool publishes agent work and its context; it does not replace the project’s source-control system.

## Development

```bash
pnpm install
pnpm run rebuild:native:node
```

Run the checks for the Share surfaces with:

```bash
pnpm --filter @spool-lab/cli typecheck
pnpm --filter @spool-lab/cli test
pnpm --filter @spool/backend typecheck
pnpm --filter @spool/backend test
pnpm --filter @spool/web typecheck
pnpm --filter @spool/web test
pnpm --filter @spool/web build
```

Start the backend and Web documentation site in separate terminals:

```bash
pnpm --filter @spool/backend dev
pnpm --filter @spool/web dev
```

## License

MIT

## Trademark

“Spool” and the Spool logo are trademarks of TypeSafe Limited. The MIT License covers the source code only and does not grant permission to use the Spool name or logo. See [LICENSE](LICENSE).

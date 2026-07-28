# Contributing to Spool

Thanks for your interest in contributing! Spool is early-stage and we welcome all kinds of help.

## Getting started

```bash
git clone https://github.com/spool-lab/spool.git
cd spool
pnpm install
pnpm check
pnpm spool --help
```

## Native module runtime

`better-sqlite3` powers the installed CLI and local Session engine. The repository caches its addon
by platform, architecture, and Node module ABI. `pnpm test` rebuilds the Node addon first through the
root `pretest` hook.

If you hit a `NODE_MODULE_VERSION` mismatch after changing Node versions or platforms, rebuild it
manually:

```bash
pnpm run rebuild:native:node
```

## Project structure

```
apps/
  cli/          CLI for Session preparation, sharing, reading, and Resume
  web/          spool.new website, docs, Profiles, account pages, and Session reader
  backend/      Hub, identity, publication, and media API on Cloudflare
  app/          Archived Electron source; excluded from workspace and automation
packages/
  core/         Local Session ingestion, organization, SQLite, and search
  redact/       Sensitive-data detection shared by publishing surfaces
  session-kit/  Browser-safe canonical records, views, and Session diffs
  session-view/ Browser-safe conversation renderer
  share-kit/    Curated `.spool` documents, templates, and export primitives
```

## Publishing: local development stack

Most contributions never need the whole stack. Set it up when working on the Hub, public Session
pages, account/Profile surfaces, or CLI publishing flow.

The stack is two processes: backend (Wrangler, `:8788`) and Web (Vite, `:3002`).
`./scripts/share-dev.sh` boots both. One-time setup first:

1. **WorkOS dev environment** — create one at
   [dashboard.workos.com](https://dashboard.workos.com) (never reuse prod
   credentials). Note the environment client id (`client_...`) and an API
   key (`sk_...`), and register this redirect URI:
   - `http://localhost:3002/api/auth/workos/callback` (web sign-in) —
     without this, web sign-in fails with a redirect_uri mismatch.

   The repository-local CLI needs no credentials of its own: `pnpm spool login` uses the
   browser-approval flow at `/cli-auth`, which rides on the web session.

2. **One gitignored config file**:

   ```bash
   cp apps/backend/.dev.vars.example apps/backend/.dev.vars
   ```

   Fill in the WorkOS values per the comments in the file.

3. **Local D1 schema**:

   ```bash
   cd apps/backend
   corepack pnpm wrangler d1 migrations apply spool-share-db --local
   ```

4. **Run it**:

   ```bash
   ./scripts/share-dev.sh
   ```

   In another terminal, the repository-local CLI automatically selects the
   local Hub:

   ```bash
   pnpm spool login
   ```

   Set `SPOOL_HUB_URL` explicitly only when you want another Hub.

Sign in with any method AuthKit offers (email code works out of the box);
data lands in the local D1/KV/R2 under
`apps/backend/.wrangler/state/`. The repository-local CLI uses the normal
`~/.spool/` library and automatically selects the local Hub when invoked through `pnpm spool`.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm check` to make sure nothing is broken
4. Open a pull request

## Verifying changes

Run the checks for the surface you touched; before merging anything substantial, run the active
product matrix:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @spool-lab/core test
pnpm --filter @spool-lab/cli test
pnpm --filter @spool/backend test
pnpm --filter @spool/web test
pnpm --filter @spool/web build
pnpm --filter @spool/web exec playwright install chromium
pnpm test:e2e
```

## Dependency maintenance

Dependabot deliberately opens one grouped patch update each month. Minor and major upgrades are manual so framework and runtime migrations do not share a lockfile diff with routine maintenance. One dependency is also manual at every version:

- `better-sqlite3`, which must be validated against both the Node and Electron ABIs

Review grouped ACP patches as a coordinated lockfile change: the Codex extension publishes exact-version platform binaries, while the ACP SDK and Claude extension have independent version lines. For Electron or native-module changes, run the full verification matrix above plus the packaged smoke, code-signing check, and package-size report. Dependabot security alerts remain enabled separately from version updates.

## What to work on

- Check [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests
- Small fixes (typos, docs, UI polish) are always welcome — no issue needed
- For larger changes, open an issue first so we can discuss the approach

## Style

- `pnpm lint` runs oxlint (config in `.oxlintrc.json`); beyond that, match the surrounding code style
- Commit messages: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`

## Community

- [Discord](https://discord.gg/aqeDxQUs5E) for questions and discussion
- [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests

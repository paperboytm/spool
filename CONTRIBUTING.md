# Contributing to Spool

Thanks for your interest in contributing! Spool is early-stage and we welcome all kinds of help.

## Getting started

```bash
git clone https://github.com/spool-lab/spool.git
cd spool
pnpm install
pnpm dev
```

## Native module runtimes

`better-sqlite3` is used from both Node-based tests and the Electron app. Rebuild it for the runtime you are about to use:

```bash
pnpm run rebuild:native:node      # Node / vitest / core tests
pnpm run rebuild:native:electron  # Electron app / Playwright e2e
```

If you hit a `NODE_MODULE_VERSION` mismatch, rerun the matching rebuild command and try again.

## Installing a local build (macOS)

To test a production build of the app locally — builds, installs to `/Applications/Spool.app`, and launches it:

```bash
pnpm dev:install:mac
```

Requires Apple Silicon. The script quits any running Spool instance before replacing the bundle and strips the quarantine attribute so Gatekeeper doesn't block the unsigned local build.

## Project structure

```
packages/
  app/            Electron macOS app (React + Vite + Tailwind)
  core/           Indexing engine (SQLite + FTS5)
  cli/            CLI interface
  landing/        spool.pro website
  redact/         Sensitive-data detection shared by app + share surfaces
  share-kit/      Share templates + snapshot rendering (app + share-web)
  share-backend/  spool.pro publish API (Cloudflare Pages Functions: D1/KV/R2)
  share-web/      spool.pro public reader + profile + account pages
```

## Share publish: local dev stack

Most contributions never need this — `pnpm dev` runs the app fine without
it. Set it up only when working on the publish flow (share-backend,
share-web, or the app's publish surfaces).

The stack is three processes: share-backend (wrangler, :8788), share-web
(vite, :3002), and the Electron app pointed at the local backend.
`./scripts/share-dev.sh` boots all three. One-time setup first:

1. **Google OAuth dev clients** — create a "Spool Dev" project in
   [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   with TWO OAuth clients (never reuse prod ids):
   - a **Desktop app** client (the Electron loopback sign-in). Note both
     the client id and the client secret (download the JSON to find it).
   - a **Web application** client (share-web sign-in) with
     `http://localhost:3002/api/auth/google/callback` registered as an
     authorised redirect URI — without this, web sign-in fails with
     `redirect_uri_mismatch`.

2. **Two gitignored config files**, one per runtime (wrangler and
   electron-vite each have their own loader — the values overlap but the
   files don't):
   ```bash
   cp packages/share-backend/.dev.vars.example packages/share-backend/.dev.vars
   cp packages/app/.env.development.local.example packages/app/.env.development.local
   ```
   Fill in the Google ids/secrets per the comments in each file.

3. **Local D1 schema**:
   ```bash
   cd packages/share-backend
   corepack pnpm wrangler d1 migrations apply spool-share-db --local
   ```

4. **Run it**:
   ```bash
   ./scripts/share-dev.sh
   ```

Sign in with any Google account; data lands in the local D1/KV/R2 under
`packages/share-backend/.wrangler/state/`. The app keeps its dev library
in `~/.spool-dev/` as usual.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm test` to make sure nothing is broken
4. Open a pull request

## What to work on

- Check [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests
- Small fixes (typos, docs, UI polish) are always welcome — no issue needed
- For larger changes, open an issue first so we can discuss the approach

## Style

- No linter config yet — just match the surrounding code style
- Commit messages: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`

## Community

- [Discord](https://discord.gg/aqeDxQUs5E) for questions and discussion
- [Issues](https://github.com/spool-lab/spool/issues) for bugs and feature requests

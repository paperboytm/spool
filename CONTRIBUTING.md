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

`better-sqlite3` is used from both Node-based tests and the Electron app, and the workspace keeps a single copy that must match the runtime in use. The scripts manage the switching for you:

- `pnpm test` (and `pnpm check`) rebuild for Node first via the root `pretest`.
- `pnpm dev`, `pnpm test:e2e`, and the `package:*` scripts run through `scripts/with-electron-native.mjs`, which flips the binary to the Electron ABI for the wrapped command and restores the Node ABI afterwards.

An interrupted run (Ctrl-C skips the restore) can leave the wrong ABI behind. If you hit a `NODE_MODULE_VERSION` mismatch, rebuild manually for the runtime you are about to use:

```bash
pnpm run rebuild:native:node      # Node / vitest / core tests
pnpm run rebuild:native:electron  # Electron app / Playwright e2e
```

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

1. **WorkOS dev environment** — create one at
   [dashboard.workos.com](https://dashboard.workos.com) (never reuse prod
   credentials). Note the environment client id (`client_...`) and an API
   key (`sk_...`), and register TWO redirect URIs:
   - `http://localhost:3002/api/auth/workos/callback` (web sign-in) —
     without this, web sign-in fails with a redirect_uri mismatch.
   - `spool://auth/callback` (desktop sign-in) — the app runs the PKCE
     authorize in the system browser and gets the code back on this
     custom scheme.

   The CLI needs no credentials of its own: `spool login` uses the
   browser-approval flow at `/cli-auth`, which rides on the web session.

2. **Two gitignored config files** (wrangler and electron-vite each have
   their own loader):
   ```bash
   cp packages/share-backend/.dev.vars.example packages/share-backend/.dev.vars
   cp packages/app/.env.development.local.example packages/app/.env.development.local
   ```
   Fill in the WorkOS values per the comments in each file — the API key
   goes only in `.dev.vars`; the app env needs just the (public) client
   id as `SPOOL_WORKOS_CLIENT_ID`.

3. **Local D1 schema**:
   ```bash
   cd packages/share-backend
   corepack pnpm wrangler d1 migrations apply spool-share-db --local
   ```

4. **Run it**:
   ```bash
   ./scripts/share-dev.sh
   ```

Sign in with any method AuthKit offers (email code works out of the box);
data lands in the local D1/KV/R2 under
`packages/share-backend/.wrangler/state/`. The app keeps its dev library
in `~/.spool-dev/` as usual.

## Making changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `pnpm check` to make sure nothing is broken
4. Open a pull request

## Verifying changes

Run the checks for the surface you touched; before merging anything substantial, run the full matrix:

```bash
pnpm install --frozen-lockfile
pnpm check                          # typecheck + lint + unit tests
pnpm --filter @spool/app test:e2e   # Playwright, needs a desktop session
```

For desktop packaging changes, also verify the packaged app — never remove a packaged asset based on import search alone; dynamic loading hides from grep:

```bash
pnpm run package:mac                # build + electron-builder (arm64)
codesign --verify --deep --strict --verbose=2 \
  packages/app/dist/mac-arm64/Spool.app
node packages/app/scripts/smoke-packaged.mjs packages/app/dist/mac-arm64/Spool.app
node packages/app/scripts/package-size-report.mjs packages/app/dist/mac-arm64/Spool.app
```

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

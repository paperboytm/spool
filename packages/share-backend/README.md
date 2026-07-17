# @spool/share-backend

Cloudflare Pages Functions backing `spool.pro`: auth, publish/read/revoke, OG image generation, profile, /me, and admin audit access.

Auth surfaces (WorkOS AuthKit is the only identity provider):

- **Web** — AuthKit authorization-code flow via the provider registry (`/api/auth/workos/{start,callback}`). First WorkOS sign-in links onto a pre-existing Google-era account via the WorkOS identities API (`resolveAliasIdentities`), so legacy users keep their handle and shares.
- **Desktop** — WorkOS PKCE public client (per the official Electron example): the app runs authorize in the system browser with a `spool://auth/callback` custom-scheme redirect, then posts `{code, code_verifier}` to `/api/auth/sign-in-with-code`, which redeems the code, reuses the web upsert/linking path, and mints a KV session.
- **CLI** — self-hosted device flow under `/api/cli-auth/{start,approve,poll}`: `spool login` opens `spool.pro/cli-auth?code=XXXX-XXXX`, the signed-in user approves in the browser, the CLI polls and claims a `sph_` API token. Works over SSH (the poll loop receives the token, not the browser). Deliberately not WorkOS's device grant: the broker rides the web session, so the CLI stays provider-agnostic. `spool logout` revokes the token via `DELETE /api/hub/v1/tokens` (self-revoke: the bearer names the token to kill; a web session can't).

> **Resource IDs are not in this repo.** Production D1 / KV / R2 bindings are configured per-project in the Cloudflare Pages dashboard. `wrangler.toml` carries only the binding names + bucket names + binding shape — `database_id` / KV `id` fields are intentionally omitted. External contributors do not need any Cloudflare account to run the full stack locally; `wrangler pages dev` emulates every binding with throwaway files under `.wrangler/state/`. The Pages dashboard is the source of truth for production. See `docs/runbooks/spool-share-launch.md` §1 for the one-time prod setup; operator may keep a local `wrangler.toml.local` (gitignored) if they want a copy with real ids for occasional remote operations.

## Local development

Tests are hermetic and need no setup:

```bash
pnpm install
pnpm --filter @spool/share-backend test
pnpm --filter @spool/share-backend typecheck
```

The suite composes handlers against in-memory KV/D1/R2 fakes in `tests/_helpers/fakes.ts`. No wrangler / Cloudflare login required.

### Running the backend end-to-end against a local app

For functional smoke tests (publish → read → revoke loop in a real browser, or against the Spool desktop app), boot wrangler with local D1/KV/R2 emulation:

```bash
# 1. Copy the local secrets template + fill in dev WorkOS credentials.
#    .dev.vars is gitignored. See the file's header for how to obtain each.
cp packages/share-backend/.dev.vars.example packages/share-backend/.dev.vars
$EDITOR packages/share-backend/.dev.vars

# 2. Apply migrations to a local SQLite file (one-time + after schema changes).
cd packages/share-backend
corepack pnpm wrangler d1 migrations apply spool-share-db --local

# 3. Boot. Wrangler serves on http://localhost:8788, persists D1/KV/R2 to
#    .wrangler/state/ (gitignored). No Cloudflare account needed.
corepack pnpm dev
```

The full three-process dev environment (share-backend + share-web + Spool app) ships as `scripts/share-dev.sh` at the repo root — invoke that to bring the whole loop up under one terminal.

## Pre-deploy pentest

Before promoting a build to production, run:

```bash
TARGET=https://staging.spool.pro ./tests/pentest.sh
```

This probes security headers, unauthenticated access, slug + handle enumeration, and open-redirect surfaces. It exits non-zero on any failure. The script is NOT wired into CI — it is a manual gate.

## Deploy

Bindings (D1, KV, R2) and secrets (WorkOS client id + API key, session key, admin user ids) are configured per-Pages-project in the Cloudflare dashboard. The dashboard — not this repo — is the source of truth for production resource ids. See the launch runbook §1 for the one-time setup; on CI, `wrangler pages deploy --project-name spool-share-backend` works without any id in code because the project carries its bindings.

The scheduled deletion worker (`functions/_scheduled/deletion-worker.ts`) is structured as a standalone `scheduled` handler; Pages Functions do not currently trigger crons, so it should be deployed as a companion Worker against the same bindings.

# @spool/share-backend

Cloudflare Pages Functions backing `spool.share`: auth (Google OAuth desktop + web), publish/read/revoke, OG image generation, profile, /me, abuse reporting, and admin audit access.

## Local development

```bash
pnpm install
pnpm --filter @spool-lab/redact build   # share-backend transitively depends on its dist
pnpm --filter @spool/share-backend test
pnpm --filter @spool/share-backend typecheck
pnpm --filter @spool/share-backend dev   # wrangler pages dev — requires CF login
```

Tests run hermetically without `wrangler dev` — the suite composes handlers against in-memory KV/D1/R2 fakes in `tests/_helpers/fakes.ts`.

## Pre-deploy pentest

Before promoting a build to production, run:

```bash
TARGET=https://staging.spool.share ./tests/pentest.sh
```

This probes security headers, unauthenticated access, slug + handle enumeration, and open-redirect surfaces. It exits non-zero on any failure. The script is NOT wired into CI — it is a manual gate.

## Deploy

Bindings (D1, KV, R2) and secrets (Google client IDs, web client secret, session key, abuse-notify email, admin user ids) must be configured in the Cloudflare dashboard before the first deploy. Placeholder IDs in `wrangler.toml` MUST be replaced.

The scheduled deletion worker (`functions/_scheduled/deletion-worker.ts`) is structured as a standalone `scheduled` handler; Pages Functions do not currently trigger crons, so it should be deployed as a companion Worker against the same bindings.

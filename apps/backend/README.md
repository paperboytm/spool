# @spool/backend

Cloudflare Pages Functions backing spool.new identity, Hub storage, Session reads, publication documents, Profiles, account management, media, and audit surfaces.

## Responsibilities

- authenticate Web, Desktop, and CLI clients;
- store content-addressed Session records, views, and attached `.spool` documents;
- enforce owner-scoped writes, Link-only reads, withdrawal, quotas, and rate limits;
- serve public Session metadata and ranged records;
- manage Profile identity and publication visibility;
- generate social metadata and images;
- schedule account deletion and physical object cleanup.

The Hub does not modify provider Session content. Canonical records are verified on write, and content-object deduplication is isolated per owner.

## Authentication

- **Web** — WorkOS AuthKit authorization-code flow through `/api/auth/workos/{start,callback}`
- **Desktop** — WorkOS PKCE public client with the `spool://auth/callback` custom scheme; the app exchanges the code through `/api/auth/sign-in-with-code`
- **CLI** — provider-independent browser approval through `/api/cli-auth/{start,approve,poll}`; the polling terminal receives a revocable `sph_` API token

`npx @spool-lab/cli logout` revokes the active CLI token through `DELETE /api/hub/v1/tokens`.

## Cloudflare Bindings

`wrangler.prod.toml` and `wrangler.staging.toml` are the committed source of truth for each environment's Pages project and D1/KV/R2 identifiers. Resource identifiers are not credentials. WorkOS credentials and other secret values remain in Cloudflare, while CI authentication stays in GitHub Actions secrets. The base `wrangler.toml` defines the equivalent local-emulation shape.

Bindings include:

- D1 for users, Hub refs, Profiles, credentials, and audit state;
- KV for web sessions, metadata, rate limits, and nonces;
- R2 for Session packs, publication documents, avatars, and generated media.

## Tests

The test suite is hermetic and uses in-memory D1/KV/R2 fakes:

```bash
pnpm install
pnpm --filter @spool/backend typecheck
pnpm --filter @spool/backend run schema:smoke
pnpm --filter @spool/backend test
```

The schema smoke creates an isolated temporary local D1 database, applies every committed migration, verifies the migration ledger, and runs `PRAGMA foreign_key_check`. No Cloudflare account is required.

## Local Development

Create development WorkOS credentials and copy the local secret template:

```bash
cp apps/backend/.dev.vars.example apps/backend/.dev.vars
$EDITOR apps/backend/.dev.vars
```

Register these redirect URIs in the WorkOS development environment:

```text
http://localhost:3002/api/auth/workos/callback
spool://auth/callback
```

Apply every migration to the persistent local-development D1 database:

```bash
pnpm --filter @spool/backend run d1:migrate:local
```

Start only the backend:

```bash
corepack pnpm dev
```

Wrangler serves on `http://localhost:8788` and persists emulated data under `apps/backend/.wrangler/state/`.

For Backend + Web + Desktop together:

```bash
./scripts/share-dev.sh
```

## Pre-deploy Security Check

Run the manual probe against staging before production promotion:

```bash
TARGET=https://staging.spool.new ./apps/backend/tests/pentest.sh
```

It checks security headers, unauthenticated access, identifier enumeration, and redirect handling.

## Deploy

Production and staging Wrangler files select the Cloudflare project and storage resources. Secret values must already exist on the corresponding Pages project.

A push to `main` deploys production. A manual `Deploy Cloudflare` workflow dispatch defaults to staging and can explicitly select production. The workflow builds first, applies the selected environment's complete D1 migration set, deploys Pages, and then deploys the matching web router. Any failed step stops the release before later components are published.

Production additionally deploys the account-deletion companion Worker under `workers/spool-share-deletion`, using the same committed D1/KV/R2 resources (including the Hub bucket).

### WorkOS Team operations

D1 is the runtime Team authorization source of truth. WorkOS membership and
organization deletes are placed in `workos_cleanup_outbox`; Pages drains that
table with its existing `WORKOS_API_KEY`. The deletion Worker only triggers the
protected Pages drain endpoint and never receives the WorkOS key.

Generate one high-entropy operations token and install the same value on Pages
and the companion Worker (do not print it or commit it):

```bash
wrangler pages secret put WORKOS_OPERATIONS_TOKEN --project-name spool-share-backend
wrangler secret put WORKOS_OPERATIONS_TOKEN \
  --config workers/spool-share-deletion/wrangler.prod.toml
```

Webhook registration is an intentionally temporary bootstrap. Set a separate
one-time token on Pages, deploy, then call the endpoint with an empty body. It
creates or repairs exactly `https://spool.new/api/webhooks/workos`, enabled only
for membership deletion/update, organization deletion, and user deletion. The
response secret must be piped directly back into Cloudflare and never logged:

```bash
wrangler pages secret put WORKOS_BOOTSTRAP_TOKEN --project-name spool-share-backend

bootstrap_json="$(curl -fsS -X POST \
  -H "Authorization: Bearer $WORKOS_BOOTSTRAP_TOKEN" \
  https://spool.new/api/internal/workos/bootstrap-webhook)"
printf '%s' "$bootstrap_json" | jq -er '.secret' | \
  wrangler pages secret put WORKOS_WEBHOOK_SECRET --project-name spool-share-backend
unset bootstrap_json

wrangler pages secret delete WORKOS_BOOTSTRAP_TOKEN --project-name spool-share-backend
```

Redeploy Pages after removing the bootstrap token. Without
`WORKOS_BOOTSTRAP_TOKEN`, the bootstrap route returns 404; the long-lived
cleanup endpoint independently requires `WORKOS_OPERATIONS_TOKEN` using a
constant-time comparison.

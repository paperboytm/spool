# @spool/backend

Cloudflare Pages Functions backing spool.pro identity, Hub storage, Session reads, publication documents, Profiles, account management, media, and audit surfaces.

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

`spool logout` revokes the active CLI token through `DELETE /api/hub/v1/tokens`.

## Cloudflare Bindings

Production resource identifiers are configured on the Cloudflare project, not committed to the repository. Wrangler files define binding names and shape; external contributors can run the complete stack against local emulation.

Bindings include:

- D1 for users, Hub refs, Profiles, credentials, and audit state;
- KV for web sessions, metadata, rate limits, and nonces;
- R2 for Session packs, publication documents, avatars, and generated media.

## Tests

The test suite is hermetic and uses in-memory D1/KV/R2 fakes:

```bash
pnpm install
pnpm --filter @spool/backend typecheck
pnpm --filter @spool/backend test
```

No Cloudflare account is required.

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

Apply every migration to local D1:

```bash
cd apps/backend
corepack pnpm wrangler d1 migrations apply spool-share-db --local
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
TARGET=https://staging.spool.pro ./apps/backend/tests/pentest.sh
```

It checks security headers, unauthenticated access, identifier enumeration, and redirect handling.

## Deploy

Production and staging Wrangler files select the Cloudflare project environment. Resource bindings and secrets must already exist on that project.

The account-deletion scheduled handler is deployed as the companion Worker under `workers/spool-share-deletion`, using the same storage bindings.

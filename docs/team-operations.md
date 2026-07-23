# Team production operations

Team workspaces span two control planes:

- WorkOS carries Organizations, hosted invitations, and membership lifecycle events.
- Spool D1 is the runtime authorization, role, ownership, quota, and audit source of truth.

The two sides are joined by a signed webhook for inbound deprovisioning and a durable D1 outbox for retrying outbound cleanup. A deployment is not complete until both directions are configured.

## WorkOS environment boundary

WorkOS Staging and Production are isolated. Client IDs, API keys, users, Organizations, webhook endpoints, signing secrets, and branding do not move between them.

`spool.new` currently uses the existing WorkOS Staging application for online acceptance. Do not describe that setup as customer production. Before serving real customers, unlock WorkOS Production, configure `https://spool.new/api/auth/workos/callback`, and plan identity continuity before replacing `WORKOS_CLIENT_ID` or `WORKOS_API_KEY`. A Production WorkOS user has a different `provider_sub`; users without an existing alias identity can otherwise be forked into a new Spool account.

## WorkOS application redirects

Configure the application that owns `WORKOS_CLIENT_ID` under **Applications → Redirects**:

- Redirect URI: `https://spool.new/api/auth/workos/callback`
- App homepage: `https://spool.new/`
- Sign-in endpoint: `https://spool.new/api/auth/workos/start`

The sign-in endpoint deliberately starts a fresh state-protected AuthKit flow. It is needed when WorkOS initiates authentication outside Spool, such as from an email flow. Do not point WorkOS directly at the callback: a callback without Spool's state cookies cannot establish a Spool session and enters only the controlled recovery described below. Leave custom sign-up, user-invitation, and password-reset URLs unset unless Spool implements matching routes; WorkOS-hosted flows remain the source of truth for those actions.

AuthKit's hosted invitation flow may still return an authorization code without
the application state created by Spool. The callback redeems that code only to
finish WorkOS's hosted ceremony, discards its unbound identity result, and
restarts through the sign-in endpoint. A code-only callback must never create a
Spool browser session; the second callback must pass the normal state-cookie
checks before membership reconciliation runs.

## Required production secrets

Cloudflare Pages project `spool-share-backend`:

- `SESSION_SIGNING_KEY`
- `WORKOS_CLIENT_ID`
- `WORKOS_API_KEY`
- `WORKOS_WEBHOOK_SECRET`
- `WORKOS_OPERATIONS_TOKEN`

Worker `spool-share-deletion`:

- `WORKOS_OPERATIONS_TOKEN` — exactly the same value as Pages

`WORKOS_BOOTSTRAP_TOKEN` is temporary. It must exist only for the one-time webhook bootstrap and must be removed afterward.

List secret names with Wrangler; never print or persist their values in logs:

```bash
pnpm --filter @spool/backend exec wrangler pages secret list \
  --project-name spool-share-backend
pnpm --filter spool-share-deletion exec wrangler secret list \
  --config wrangler.prod.toml --format json
```

## One-time webhook bootstrap

Use a shell with tracing disabled. The temporary token and bootstrap response must not be printed, committed, or uploaded as an artifact.

1. Generate one high-entropy `WORKOS_OPERATIONS_TOKEN`; pipe the same value to the Pages and Worker `secret put` commands.
2. Generate and set a temporary Pages `WORKOS_BOOTSTRAP_TOKEN`.
3. Deploy migrations, the deletion Worker, Pages, and the web router. Pages secrets only enter a new deployment.
4. POST an empty body to `/api/internal/workos/bootstrap-webhook` with the temporary bearer token. The endpoint idempotently creates or updates `${PUBLIC_BASE_URL}/api/webhooks/workos` for the minimum event set and returns the WorkOS signing secret.
5. Pipe only `.secret` from that response to the Pages `WORKOS_WEBHOOK_SECRET` secret.
6. Delete `WORKOS_BOOTSTRAP_TOKEN` from Pages.
7. Deploy Pages again so the live deployment receives the signing secret and loses the bootstrap token.
8. Submit an invalid-signature probe to `/api/webhooks/workos`. `400` proves the signing secret is loaded; `404` means the live deployment is not configured.

The bootstrap endpoint is rate-limited, accepts no request body, returns `404` for a missing or incorrect token, and always returns `Cache-Control: no-store`.

## Release order

Production releases use this order:

1. Non-E2E source, schema, type, unit, build, and Worker dry-run checks.
2. Verify Cloudflare account and required secret names.
3. Apply D1 migrations.
4. Deploy `spool-share-deletion` so fail-closed ownership checks lead the API change.
5. Deploy `spool-share-backend` Pages Functions.
6. Deploy `spool-new-router`.
7. Verify route ownership, health commit, anonymous Team rejection, and webhook signature rejection.

Production deploys queue rather than cancel a running release. This prevents a newer push from stopping after only D1 or Pages has changed.

## Operational checks

```bash
curl -fsS -D - https://spool.new/api/health

test "$(curl -sS -o /dev/null -w '%{http_code}' \
  https://spool.new/api/teams)" = 401

test "$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H 'content-type: application/json' -d '{}' \
  https://spool.new/api/webhooks/workos)" = 400
```

`/api/health` must include `x-spool-route: backend`, `ok: true`, and a non-`dev` commit SHA.

Check migration and durability state without selecting personal data:

```bash
pnpm --filter @spool/backend exec wrangler d1 migrations list spool-share-db \
  --remote --config wrangler.prod.toml

pnpm --filter @spool/backend exec wrangler d1 execute spool-share-db \
  --remote --config wrangler.prod.toml \
  --command "SELECT COUNT(*) AS pending, COALESCE(MAX(attempts),0) AS max_attempts FROM workos_cleanup_outbox;" \
  --json
```

The deletion Worker must have cron `0 */6 * * *`. New Cloudflare cron changes can take several minutes to propagate.

## Fail-closed behavior

- A removed member is blocked locally before WorkOS cleanup is attempted.
- Missing or stale webhook delivery is repaired during complete WorkOS membership reconciliation at sign-in.
- Removing the final Owner archives the Team rather than leaving ownerless data.
- Account deletion is rejected for an active Team Owner and rechecked immediately before destructive worker actions.
- Team-only Session reads use current D1 membership on every request and `private, no-store`.
- A withdrawn Team Session is a permanent tombstone and cannot be revived by a new head.
- WorkOS cleanup failures remain in `workos_cleanup_outbox` with bounded exponential backoff.

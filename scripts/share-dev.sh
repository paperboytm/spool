#!/usr/bin/env bash
# Boot the full share-publish stack locally for end-to-end smoke tests.
#
# Brings up three processes in parallel:
#   - share-backend on http://localhost:8788   (wrangler pages dev, local D1/KV/R2)
#   - share-web      on http://localhost:3002   (vite dev, /api/* proxied to backend)
#   - Spool app      (electron + vite, env-pinned to talk to local backend)
#
# Prerequisites (one-time) — full walkthrough in CONTRIBUTING.md
# ("Share publish: local dev stack"):
#   1. packages/share-backend/.dev.vars must exist + be filled. Copy from
#      .dev.vars.example and follow the inline instructions to grab dev
#      WorkOS credentials.
#   2. packages/app/.env.development.local must exist + be filled. Copy
#      from .env.development.local.example — electron-vite inlines
#      SPOOL_WORKOS_CLIENT_ID into the main bundle at dev build time, so
#      no shell exports are needed (exports still work and win).
#   3. Apply migrations to local sqlite:
#        cd packages/share-backend
#        corepack pnpm wrangler d1 migrations apply spool-share-db --local
#
# Sign-in: web and desktop both run through WorkOS AuthKit — web via the
# authorization-code flow on the backend, desktop via a PKCE public
# client (system browser + spool:// callback; needs only the client id,
# checked below). The CLI needs no credentials at all: `spool login`
# rides the web session through the /cli-auth browser-approval broker.
#
# Usage:
#   ./scripts/share-dev.sh
#
# Ctrl-C kills all three. Logs are interleaved on this terminal; for a
# more readable run, point each process at its own pane (tmux / WezTerm
# splits) using the same env vars below.
#
# Why VITE_FEATURE_SHAREPUBLISH=1: the renderer flag for the publish
# surface is DEV-default-OFF (so other contributors don't see it after
# merge). Setting it here flips the flag back on for this run only.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f packages/share-backend/.dev.vars ]]; then
  echo "ERROR: packages/share-backend/.dev.vars missing." >&2
  echo "       Copy .dev.vars.example to .dev.vars and fill in the dev" >&2
  echo "       WorkOS credentials. See its header for instructions." >&2
  exit 1
fi

# The app's desktop sign-in needs the WorkOS client id from either the
# shell or packages/app/.env.development.local (electron-vite inlines
# the file at dev build time; shell exports take precedence).
app_env=packages/app/.env.development.local
has_app_var() {
  # exported and non-empty, or a non-empty assignment in the env file
  [[ -n "${!1:-}" ]] || { [[ -f "$app_env" ]] && grep -Eq "^$1=.+" "$app_env"; }
}
if ! has_app_var SPOOL_WORKOS_CLIENT_ID; then
  echo "ERROR: SPOOL_WORKOS_CLIENT_ID is not set." >&2
  echo "       Fill it in packages/app/.env.development.local (copy the" >&2
  echo "       .example next to it) or export it in your shell. Same value" >&2
  echo "       as WORKOS_CLIENT_ID in share-backend/.dev.vars — desktop" >&2
  echo "       sign-in fails at runtime without it." >&2
  exit 1
fi

trap 'echo; echo "shutting down share-dev"; kill 0' INT TERM EXIT

# The web sign-in's code→token exchange (and the identities lookup for
# legacy-account linking) runs inside workerd, whose outbound fetch
# consults no proxy (cloudflare/workers-sdk#4515, backlog). On
# proxy-only networks (no TUN) those calls to api.workos.com hang and
# every sign-in times out. When the shell carries a proxy env, reroute
# them through the share-web vite dev middleware (Node side,
# proxy-aware) — see devWorkosRelay in packages/share-web/vite.config.ts.
# Without a proxy env, workerd's direct connection is assumed to work
# and the binding stays unset.
DEV_BINDING_ARGS=()
if [[ -n "${https_proxy:-}${HTTPS_PROXY:-}${all_proxy:-}${ALL_PROXY:-}" ]]; then
  DEV_BINDING_ARGS+=(--binding "DEV_WORKOS_API_URL=http://localhost:3002/__dev/workos")
  echo "→ workos relay   workerd → vite /__dev/workos (proxy env detected)"
fi

echo "→ share-backend  http://localhost:8788"
(cd packages/share-backend && corepack pnpm dev ${DEV_BINDING_ARGS[@]+"${DEV_BINDING_ARGS[@]}"}) &

echo "→ share-web      http://localhost:3002"
(cd packages/share-web && corepack pnpm dev) &

echo "→ Spool app      (electron)"
SPOOL_SHARE_BACKEND=http://localhost:8788 \
  VITE_FEATURE_SHAREPUBLISH=1 \
  corepack pnpm --filter @spool/app dev &

wait

#!/usr/bin/env bash
# Boot the CLI + Web publishing stack locally for focused smoke tests.
#
# Brings up two processes in parallel:
#   - share-backend on http://localhost:8788   (wrangler pages dev, local D1/KV/R2)
#   - web (merged)   on http://localhost:3002   (vite dev, landing + share pages, /api/* proxied)
#
# Prerequisites (one-time) — full walkthrough in CONTRIBUTING.md
# ("Share publish: local dev stack"):
#   1. apps/backend/.dev.vars must exist + be filled. Copy from
#      .dev.vars.example and follow the inline instructions to grab dev
#      WorkOS credentials.
#   2. Apply migrations to local sqlite:
#        cd apps/backend
#        corepack pnpm wrangler d1 migrations apply spool-share-db --local
#
# Sign-in: Web runs through WorkOS AuthKit. The CLI needs no credentials
# of its own: `pnpm spool login` rides the Web session through the
# /cli-auth browser-approval broker.
#
# Usage:
#   ./scripts/share-dev.sh
#
# Ctrl-C kills both. Logs are interleaved on this terminal; for a
# more readable run, point each process at its own pane (tmux / WezTerm
# splits) using the same env vars below.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f apps/backend/.dev.vars ]]; then
  echo "ERROR: apps/backend/.dev.vars missing." >&2
  echo "       Copy .dev.vars.example to .dev.vars and fill in the dev" >&2
  echo "       WorkOS credentials. See its header for instructions." >&2
  exit 1
fi

trap 'echo; echo "shutting down share-dev"; kill 0' INT TERM EXIT

# The web sign-in's code→token exchange (and the identities lookup for
# legacy-account linking) runs inside workerd, whose outbound fetch
# consults no proxy (cloudflare/workers-sdk#4515, backlog). On
# proxy-only networks (no TUN) those calls to api.workos.com hang and
# every sign-in times out. When the shell carries a proxy env, reroute
# them through the web app's vite dev middleware (Node side,
# proxy-aware) — see devWorkosRelay in apps/web/vite.config.ts.
# Without a proxy env, workerd's direct connection is assumed to work
# and the binding stays unset.
DEV_BINDING_ARGS=()
if [[ -n "${https_proxy:-}${HTTPS_PROXY:-}${all_proxy:-}${ALL_PROXY:-}" ]]; then
  DEV_BINDING_ARGS+=(--binding "DEV_WORKOS_API_URL=http://localhost:3002/__dev/workos")
  echo "→ workos relay   workerd → vite /__dev/workos (proxy env detected)"
fi

echo "→ share-backend  http://localhost:8788"
(cd apps/backend && corepack pnpm dev ${DEV_BINDING_ARGS[@]+"${DEV_BINDING_ARGS[@]}"}) &

echo "→ web            http://localhost:3002"
(cd apps/web && corepack pnpm dev) &

wait

#!/usr/bin/env bash
# Boot the full share-publish stack locally for end-to-end smoke tests.
#
# Brings up three processes in parallel:
#   - share-backend on http://localhost:8788   (wrangler pages dev, local D1/KV/R2)
#   - share-web      on http://localhost:3002   (vite dev, /api/* proxied to backend)
#   - Spool app      (electron + vite, env-pinned to talk to local backend)
#
# Prerequisites (one-time):
#   1. packages/share-backend/.dev.vars must exist + be filled. Copy from
#      .dev.vars.example and follow the inline instructions to grab dev
#      Google OAuth client ids.
#   2. Apply migrations to local sqlite:
#        cd packages/share-backend
#        corepack pnpm wrangler d1 migrations apply spool-share-db --local
#   3. SPOOL_GOOGLE_CLIENT_ID_DESKTOP env exported in your shell (the
#      desktop OAuth client id from the same Google Console project).
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
  echo "       Copy .dev.vars.example to .dev.vars and fill in dev Google" >&2
  echo "       OAuth client ids. See its header for instructions." >&2
  exit 1
fi

if [[ -z "${SPOOL_GOOGLE_CLIENT_ID_DESKTOP:-}" ]]; then
  echo "ERROR: SPOOL_GOOGLE_CLIENT_ID_DESKTOP must be exported." >&2
  echo "       Same value as GOOGLE_CLIENT_ID_DESKTOP in .dev.vars." >&2
  exit 1
fi

trap 'echo; echo "shutting down share-dev"; kill 0' INT TERM EXIT

echo "→ share-backend  http://localhost:8788"
(cd packages/share-backend && corepack pnpm dev) &

echo "→ share-web      http://localhost:3002"
(cd packages/share-web && corepack pnpm dev) &

echo "→ Spool app      (electron)"
SPOOL_SHARE_BACKEND=http://localhost:8788 \
  VITE_FEATURE_SHAREPUBLISH=1 \
  corepack pnpm --filter @spool/app dev &

wait

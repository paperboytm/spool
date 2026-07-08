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
#      Google OAuth client ids.
#   2. packages/app/.env.development.local must exist + be filled. Copy
#      from .env.development.local.example — electron-vite inlines the
#      SPOOL_GOOGLE_* values into the main bundle at dev build time, so
#      no shell exports are needed (exports still work and win).
#   3. Apply migrations to local sqlite:
#        cd packages/share-backend
#        corepack pnpm wrangler d1 migrations apply spool-share-db --local
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

# The app's desktop OAuth pair can come from either the shell or
# packages/app/.env.development.local (electron-vite inlines the file at
# dev build time; shell exports take precedence in its loader). Check
# whichever source so a filled env file passes with zero exports.
app_env=packages/app/.env.development.local
has_app_var() {
  # exported and non-empty, or a non-empty assignment in the env file
  [[ -n "${!1:-}" ]] || { [[ -f "$app_env" ]] && grep -Eq "^$1=.+" "$app_env"; }
}
for var in SPOOL_GOOGLE_CLIENT_ID_DESKTOP SPOOL_GOOGLE_CLIENT_SECRET_DESKTOP; do
  if ! has_app_var "$var"; then
    echo "ERROR: $var is not set." >&2
    echo "       Fill it in packages/app/.env.development.local (copy the" >&2
    echo "       .example next to it) or export it in your shell. It is the" >&2
    echo "       desktop OAuth client ${var##*_} from the same Google Console" >&2
    echo "       project as .dev.vars — sign-in fails at runtime without it." >&2
    exit 1
  fi
done

trap 'echo; echo "shutting down share-dev"; kill 0' INT TERM EXIT

# Sign-in verifies the Google id_token server-side, which needs the
# JWKS from www.googleapis.com — but workerd's outbound fetch consults
# no proxy (cloudflare/workers-sdk#4515, backlog), so on proxy-only
# networks (no TUN) that fetch hangs and every sign-in times out.
# Standard emulator move: fetch the (public) signing keys on the host —
# curl follows the shell's proxy env — and inject them via a binding so
# the worker never has to leave the machine to verify. Best-effort: if
# the fetch fails (fully offline), the worker falls back to fetching
# JWKS itself, which works wherever workerd has direct connectivity.
DEV_JWKS_ARGS=()
if jwks_json=$(curl -sf --max-time 10 https://www.googleapis.com/oauth2/v3/certs) && [[ -n "$jwks_json" ]]; then
  DEV_JWKS_ARGS=(--binding "DEV_JWKS=$jwks_json")
  echo "→ JWKS           pre-fetched on host ($(printf '%s' "$jwks_json" | wc -c | tr -d ' ') bytes)"
else
  echo "→ JWKS           host pre-fetch failed; worker will fetch directly" >&2
fi
# Web sign-in's code→token exchange also runs inside workerd. When the
# shell carries a proxy env, reroute it through the share-web vite dev
# middleware (Node side, proxy-aware) — see devGoogleTokenRelay in
# packages/share-web/vite.config.ts. Without a proxy env, workerd's
# direct connection is assumed to work and the binding stays unset.
if [[ -n "${https_proxy:-}${HTTPS_PROXY:-}${all_proxy:-}${ALL_PROXY:-}" ]]; then
  DEV_JWKS_ARGS+=(--binding "DEV_GOOGLE_TOKEN_URL=http://localhost:3002/__dev/google-token")
  echo "→ token relay    workerd → vite /__dev/google-token (proxy env detected)"
fi

echo "→ share-backend  http://localhost:8788"
(cd packages/share-backend && corepack pnpm dev ${DEV_JWKS_ARGS[@]+"${DEV_JWKS_ARGS[@]}"}) &

echo "→ share-web      http://localhost:3002"
(cd packages/share-web && corepack pnpm dev) &

echo "→ Spool app      (electron)"
SPOOL_SHARE_BACKEND=http://localhost:8788 \
  VITE_FEATURE_SHAREPUBLISH=1 \
  corepack pnpm --filter @spool/app dev &

wait

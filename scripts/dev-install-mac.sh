#!/usr/bin/env bash
set -euo pipefail

# Build Spool from source and install it into /Applications.
# Intended for developer machines (Apple Silicon, unsigned local builds).
# Run from repo root: bash scripts/dev-install-mac.sh

[[ "$(uname)" == "Darwin" ]] || { echo "dev-install-mac: macOS only"; exit 1; }
[[ "$(uname -m)" == "arm64" ]] || { echo "dev-install-mac: Apple Silicon only"; exit 1; }

cd "$(dirname "$0")/.."

APP_NAME="Spool"
DEST="/Applications/${APP_NAME}.app"
BUILT="packages/app/dist/mac-arm64/${APP_NAME}.app"

echo "==> Quitting running ${APP_NAME}…"
osascript -e "quit app \"${APP_NAME}\"" 2>/dev/null || true

echo "==> Building (pnpm run package:mac)…"
pnpm run package:mac

[[ -d "$BUILT" ]] || { echo "dev-install-mac: build output not found at $BUILT"; exit 1; }

echo "==> Installing to ${DEST}…"
rm -rf "$DEST"
cp -R "$BUILT" "$DEST"

# Unsigned local builds trigger Gatekeeper; strip quarantine so `open` just works.
xattr -rd com.apple.quarantine "$DEST" 2>/dev/null || true

echo "==> Launching…"
open "$DEST"

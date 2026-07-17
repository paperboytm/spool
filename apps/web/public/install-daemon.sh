#!/usr/bin/env bash
set -euo pipefail

# Spool Daemon installer — downloads the latest release and installs to /Applications
# Usage: curl -fsSL https://spool.pro/install-daemon.sh | bash

REPO="spool-lab/spool-daemon"
APP_NAME="Spool Daemon.app"
INSTALL_DIR="/Applications"

# ── Helpers ──
info()  { printf "\033[0;34m==>\033[0m \033[1m%s\033[0m\n" "$*"; }
ok()    { printf "\033[0;32m==>\033[0m \033[1m%s\033[0m\n" "$*"; }
err()   { printf "\033[0;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

# ── Checks ──
[[ "$(uname)" == "Darwin" ]] || err "Spool Daemon installer is macOS only. Linux users: download the AppImage from https://github.com/${REPO}/releases/latest"
[[ "$(uname -m)" == "arm64" ]] || err "Spool Daemon requires Apple Silicon (M1+)."
command -v curl >/dev/null || err "curl is required."

# ── Find latest release DMG ──
# Follow the /releases/latest redirect to resolve the tag — avoids the
# unauthenticated GitHub API rate limit (60/hr/IP) which 403s shared IPs.
info "Finding latest release..."
LATEST_URL=$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
  "https://github.com/${REPO}/releases/latest")
TAG="${LATEST_URL##*/}"
VERSION="${TAG#v}"
[[ -n "$VERSION" && "$TAG" != "latest" ]] || err "Could not resolve latest release tag."
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG}/Spool-Daemon-${VERSION}-arm64.dmg"

info "Downloading Spool Daemon ${VERSION}..."

# ── Download ──
TMPDIR_INSTALL=$(mktemp -d)
DMG_PATH="${TMPDIR_INSTALL}/Spool-Daemon.dmg"
curl -fSL --progress-bar "$DOWNLOAD_URL" -o "$DMG_PATH"

# ── Mount & copy ──
info "Installing to ${INSTALL_DIR}..."
MOUNT_POINT=$(hdiutil attach "$DMG_PATH" -nobrowse | tail -1 | sed 's/.*	//')
[[ -n "$MOUNT_POINT" ]] || err "Failed to resolve mount point."
[[ -d "${MOUNT_POINT}/${APP_NAME}" ]] || err "Mounted DMG does not contain ${APP_NAME}."

# Remove old version if exists
if [[ -d "${INSTALL_DIR}/${APP_NAME}" ]]; then
  rm -rf "${INSTALL_DIR}/${APP_NAME}"
fi

cp -R "${MOUNT_POINT}/${APP_NAME}" "${INSTALL_DIR}/"

# Unmount
hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true

# ── Cleanup ──
rm -rf "$TMPDIR_INSTALL"

ok "Spool Daemon ${VERSION} installed to ${INSTALL_DIR}/${APP_NAME}"
echo ""
echo "  Open Spool Daemon from your Applications folder, or run:"
echo "  open \"/Applications/${APP_NAME}\""
echo ""

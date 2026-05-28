#!/usr/bin/env bash
set -euo pipefail

# Bumps version, tags, pushes, and dispatches the CI Release workflow.
# Build + sign + notarize + artifact upload run in GitHub Actions using the
# Developer ID Application cert and app-specific password stored as repo
# secrets (CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD,
# APPLE_TEAM_ID). The workflow also publishes @spool-lab/core and
# @spool-lab/cli to npm using NODE_AUTH_TOKEN (granular token,
# scope=@spool-lab, read+write, "Bypass 2FA" enabled). @spool-lab/redact
# is published only when its version on disk differs from the registry,
# and is bumped here in lockstep with the rest so versions stay aligned.
# See .github/workflows/release.yml.
#
# Usage:
#   ./scripts/release.sh              # patch bump (0.3.8 → 0.3.9)
#   ./scripts/release.sh --minor      # minor bump (0.3.8 → 0.4.0)

BUMP="patch"
case "${1:-}" in
  ""|--patch) BUMP="patch" ;;
  --minor)    BUMP="minor" ;;
  *)
    printf "\033[31mUnknown flag: %s\033[0m\n" "$1"
    echo "Usage: $0 [--patch|--minor]"
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
dim()   { printf "\033[90m%s\033[0m\n" "$*"; }

command -v gh >/dev/null || { red "gh CLI not found"; exit 1; }
command -v jq >/dev/null || { red "jq not found"; exit 1; }

if [[ -n "$(git status --porcelain)" ]]; then
  red "Working tree is dirty. Commit or stash first."
  exit 1
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" ]]; then
  red "Releases must be cut from main (currently on '$BRANCH')."
  exit 1
fi

OLD_VERSION=$(jq -r .version package.json)
dim "Current version: $OLD_VERSION ($BUMP bump)"

IFS='.' read -r major minor patch <<< "$OLD_VERSION"
case "$BUMP" in
  minor) minor=$((minor + 1)); patch=0 ;;
  patch) patch=$((patch + 1)) ;;
esac
NEW_VERSION="$major.$minor.$patch"
TAG="v$NEW_VERSION"
green "Bumping to $NEW_VERSION"

for f in package.json packages/app/package.json packages/core/package.json packages/cli/package.json packages/landing/package.json packages/redact/package.json; do
  if [[ -f "$f" ]]; then
    jq --arg v "$NEW_VERSION" '.version = $v' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  fi
done

git add -A
git commit -m "release: v$NEW_VERSION"
git tag -a "$TAG" -m "v$NEW_VERSION"
git push origin main
git push origin "$TAG"

green "Dispatching Release workflow on $TAG..."
gh workflow run release.yml --ref "$TAG"

# `gh workflow run` is fire-and-forget — poll for the run it just queued so we
# can hand it to `gh run watch` and block until CI finishes. Without this the
# script would return before artifacts exist, defeating the point of waiting.
dim "Waiting for workflow run to appear..."
RUN_ID=""
for _ in $(seq 1 30); do
  RUN_ID=$(gh run list --workflow=release.yml --branch "$TAG" --limit 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null || true)
  [[ -n "$RUN_ID" && "$RUN_ID" != "null" ]] && break
  sleep 2
done

if [[ -z "$RUN_ID" || "$RUN_ID" == "null" ]]; then
  red "Could not locate dispatched run. Check manually:"
  echo "  https://github.com/spool-lab/spool/actions/workflows/release.yml"
  exit 1
fi

green "Watching run $RUN_ID..."
gh run watch "$RUN_ID" --exit-status

green "Done: https://github.com/spool-lab/spool/releases/tag/$TAG"

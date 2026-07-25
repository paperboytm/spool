#!/bin/sh
set -eu

# Spool CLI installer for macOS and Linux.
# Usage: curl -fsSL https://spool.new/install.sh | sh

PACKAGE='@spool-lab/cli'
MIN_NODE_VERSION='22.19.0'

info() { printf '%s\n' "==> $*"; }
ok() { printf '%s\n' "==> $*"; }
warn() { printf '%s\n' "warning: $*" >&2; }
err() {
  printf '%s\n' "error: $*" >&2
  exit 1
}

run_node() {
  if [ -n "${_SPOOL_INSTALLER_TEST_SHIM:-}" ]; then
    sh "$_SPOOL_INSTALLER_TEST_SHIM" node "$@"
  else
    node "$@"
  fi
}
run_npm() {
  if [ -n "${_SPOOL_INSTALLER_TEST_SHIM:-}" ]; then
    sh "$_SPOOL_INSTALLER_TEST_SHIM" npm "$@"
  else
    npm "$@"
  fi
}
read_spool_version() {
  executable=$1
  if [ -n "${_SPOOL_INSTALLER_TEST_SHIM:-}" ]; then
    sh "$_SPOOL_INSTALLER_TEST_SHIM" spool "$executable" --version
  else
    "$executable" --version
  fi
}

if [ -z "${_SPOOL_INSTALLER_TEST_SHIM:-}" ]; then
  command -v node >/dev/null 2>&1 ||
    err "Node.js ${MIN_NODE_VERSION} or newer is required. Install Node.js, then run this command again."
  command -v npm >/dev/null 2>&1 ||
    err "npm is required. Install Node.js ${MIN_NODE_VERSION} or newer, then run this command again."
fi

NODE_VERSION=$(run_node -p 'process.versions.node')
run_node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  process.exit(major > 22 || (major === 22 && minor >= 19) ? 0 : 1)
' || err "Node.js ${NODE_VERSION} is too old. Spool requires Node.js ${MIN_NODE_VERSION} or newer."

case "$(uname -s)" in
  Darwin | Linux) ;;
  *) err 'The Spool installer currently supports macOS and Linux.' ;;
esac

: "${HOME:?HOME must be set}"
INSTALL_ROOT=${SPOOL_CLI_INSTALL_ROOT:-"$HOME/.local/share/spool/cli"}
BIN_DIR=${SPOOL_CLI_BIN_DIR:-"$HOME/.local/bin"}

case "$INSTALL_ROOT" in
  '' | /) err 'Refusing to use an unsafe Spool install root.' ;;
esac
case "$BIN_DIR" in
  '' | /) err 'Refusing to use an unsafe Spool bin directory.' ;;
esac

mkdir -p "$INSTALL_ROOT" "$BIN_DIR"

BIN_PATH="$BIN_DIR/spool"

is_spool_link() {
  [ -L "$BIN_PATH" ] || return 1
  link_target=$(readlink "$BIN_PATH")
  case "$link_target" in
    "$INSTALL_ROOT"/*/bin/spool | *'/@spool-lab/cli/bin/spool.js') return 0 ;;
    *) return 1 ;;
  esac
}

if [ -e "$BIN_PATH" ] || [ -L "$BIN_PATH" ]; then
  is_spool_link ||
    err "$BIN_PATH already exists and is not managed by the Spool installer. Move it, then try again."
fi

existing_version=''
if [ -x "$BIN_PATH" ]; then
  existing_version=$(
    read_spool_version "$BIN_PATH" 2>/dev/null || true
  )
fi

info 'Finding the latest Spool CLI release...'
VERSION=''
if VERSION=$(run_npm view "$PACKAGE" version 2>/dev/null); then
  case "$VERSION" in
    [0-9]*) ;;
    *) err "npm returned an invalid Spool CLI version: $VERSION" ;;
  esac
  case "$VERSION" in
    *[!0-9A-Za-z.+-]*) err "npm returned an invalid Spool CLI version: $VERSION" ;;
  esac
elif [ -n "$existing_version" ]; then
  warn "Could not check npm for updates; keeping Spool CLI $existing_version."
else
  err 'Could not reach npm to find the latest Spool CLI release.'
fi

keep_existing_or_fail() {
  failure_message=$1
  if [ -n "$existing_version" ]; then
    warn "$failure_message Keeping Spool CLI $existing_version."
    VERSION=''
    return
  fi
  err "$failure_message"
}

STAGE_DIR=''
LOG_DIR=''
LINK_TMP=''
cleanup() {
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf -- "$STAGE_DIR"
  fi
  if [ -n "$LOG_DIR" ] && [ -d "$LOG_DIR" ]; then
    rm -rf -- "$LOG_DIR"
  fi
  if [ -n "$LINK_TMP" ] && { [ -e "$LINK_TMP" ] || [ -L "$LINK_TMP" ]; }; then
    rm -f -- "$LINK_TMP"
  fi
}
trap cleanup EXIT HUP INT TERM

if [ -n "$VERSION" ]; then
  VERSION_DIR="$INSTALL_ROOT/$VERSION"
  installed_version=''
  if [ -x "$VERSION_DIR/bin/spool" ]; then
    installed_version=$(
      read_spool_version "$VERSION_DIR/bin/spool" 2>/dev/null || true
    )
  fi

  if [ "$installed_version" != "$VERSION" ]; then
    if [ -e "$VERSION_DIR" ]; then
      keep_existing_or_fail "The existing install at $VERSION_DIR is incomplete."
    fi

    if [ -n "$VERSION" ]; then
      STAGE_DIR="$INSTALL_ROOT/.install-$VERSION-$$"
      mkdir "$STAGE_DIR"
      LOG_DIR=$(mktemp -d)
      NPM_LOG="$LOG_DIR/npm-install.log"

      info "Installing Spool CLI $VERSION..."
      if ! run_npm install --global --prefix "$STAGE_DIR" --no-audit --no-fund --loglevel=error \
        "$PACKAGE@$VERSION" >"$NPM_LOG" 2>&1; then
        printf '\n'
        cat "$NPM_LOG" >&2
        keep_existing_or_fail 'Spool CLI installation failed.'
      fi

      if [ -n "$VERSION" ] && [ ! -x "$STAGE_DIR/bin/spool" ]; then
        keep_existing_or_fail 'npm did not install the spool executable.'
      fi
      if [ -n "$VERSION" ]; then
        staged_version=$(
          read_spool_version "$STAGE_DIR/bin/spool" 2>/dev/null || true
        )
        if [ "$staged_version" != "$VERSION" ]; then
          keep_existing_or_fail \
            "Installed Spool CLI reported version ${staged_version:-unknown}; expected $VERSION."
        fi
      fi

      # Another installer may have completed while npm was running. Prefer its
      # verified directory and discard this process's duplicate staging tree.
      if [ -n "$VERSION" ] && [ -e "$VERSION_DIR" ]; then
        concurrent_version=$(
          read_spool_version "$VERSION_DIR/bin/spool" 2>/dev/null || true
        )
        if [ "$concurrent_version" = "$VERSION" ]; then
          rm -rf -- "$STAGE_DIR"
          STAGE_DIR=''
        else
          keep_existing_or_fail "A concurrent install left $VERSION_DIR incomplete."
        fi
      fi

      if [ -n "$VERSION" ] && [ -n "$STAGE_DIR" ]; then
        mv "$STAGE_DIR" "$VERSION_DIR"
        STAGE_DIR=''
      fi
    fi
  fi

  if [ -n "$VERSION" ]; then
    LINK_TMP="$BIN_DIR/.spool-link-$$"
    ln -s "$VERSION_DIR/bin/spool" "$LINK_TMP"
    mv -f "$LINK_TMP" "$BIN_PATH"
    LINK_TMP=''
  fi
fi

path_configured=false
path_ready_after_restart=false
case ":${PATH:-}:" in
  *":$BIN_DIR:"*) path_configured=true ;;
esac

if [ "$path_configured" = false ] && [ "$BIN_DIR" = "$HOME/.local/bin" ]; then
  shell_path=${SHELL:-}
  case "${shell_path##*/}" in
    zsh) SHELL_RC="$HOME/.zshrc" ;;
    bash)
      if [ "$(uname -s)" = Darwin ]; then
        SHELL_RC="$HOME/.bash_profile"
      else
        SHELL_RC="$HOME/.bashrc"
      fi
      ;;
    *) SHELL_RC="$HOME/.profile" ;;
  esac

  PATH_MARKER='# Added by the Spool CLI installer'
  PATH_EXPORT='export PATH="$HOME/.local/bin:$PATH"'
  if grep -Fx "$PATH_EXPORT" "$SHELL_RC" >/dev/null 2>&1; then
    path_ready_after_restart=true
  elif {
      if ! grep -F "$PATH_MARKER" "$SHELL_RC" >/dev/null 2>&1; then
        printf '\n%s\n' "$PATH_MARKER"
      fi
      printf '%s\n' "$PATH_EXPORT"
    } >>"$SHELL_RC"; then
    path_ready_after_restart=true
    ok "Added $BIN_DIR to PATH in $SHELL_RC."
  else
    warn "Could not update $SHELL_RC. Add $BIN_DIR to PATH manually."
  fi
fi

display_version=${VERSION:-$existing_version}
ok "Spool CLI $display_version installed at $BIN_PATH."
if [ "$path_configured" = true ]; then
  printf '\nRun this in a project to share its latest Session:\n\n  spool\n\n'
elif [ "$path_ready_after_restart" = true ]; then
  printf '\nOpen a new terminal, then run this in a project:\n\n  spool\n\n'
else
  printf '\nAdd %s to PATH, or run:\n\n  %s\n\n' "$BIN_DIR" "$BIN_PATH"
fi

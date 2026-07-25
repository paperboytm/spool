#!/bin/sh
set -eu

kind=${1:-}
case "$kind" in
  node | npm | spool) shift ;;
  *) kind=${0##*/} ;;
esac

case "$kind" in
  node)
    if [ "${1:-}" = "-p" ]; then
      printf '%s\n' "${FAKE_NODE_VERSION:-22.19.0}"
      exit 0
    fi
    if [ "${1:-}" = "-e" ]; then
      exit "${FAKE_NODE_CHECK_EXIT:-0}"
    fi
    exit 1
    ;;
  npm)
    if [ "${1:-}" = "view" ]; then
      if [ "${FAKE_NPM_VIEW_FAIL:-0}" = "1" ]; then
        exit 1
      fi
      printf '%s\n' "$FAKE_CLI_VERSION"
      exit 0
    fi
    if [ "${1:-}" != "install" ]; then
      exit 2
    fi
    printf '%s\n' install >> "$FAKE_NPM_LOG"
    if [ "${FAKE_NPM_FAIL:-0}" = "1" ]; then
      printf '%s\n' 'simulated npm failure' >&2
      exit 1
    fi
    prefix=''
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--prefix" ]; then
        shift
        prefix=$1
      fi
      shift
    done
    [ -n "$prefix" ]
    mkdir -p "$prefix/bin"
    printf '%s\n' "$FAKE_CLI_VERSION" > "$prefix/.fake-version"
    ln -s "$FAKE_INSTALLER_COMMAND" "$prefix/bin/spool"
    ;;
  spool)
    executable=${1:-}
    shift
    if [ "${1:-}" = "--version" ]; then
      prefix=${executable%/bin/spool}
      if [ ! -f "$prefix/.fake-version" ] && [ -L "$executable" ]; then
        executable=$(readlink "$executable")
        prefix=${executable%/bin/spool}
      fi
      cat "$prefix/.fake-version"
      exit 0
    fi
    exit 0
    ;;
  *)
    printf '%s\n' 'unexpected installer fixture invocation' >&2
    exit 2
    ;;
esac

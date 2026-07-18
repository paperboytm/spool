// spool:// deep-link plumbing. One custom scheme for the whole app —
// today only the WorkOS sign-in callback rides it (spool://auth/callback);
// future surfaces (resume links, ...) add listeners, not schemes.
//
// Why a custom scheme and not a 127.0.0.1 loopback server: WorkOS
// production environments reject http/localhost redirect URIs outright
// (sandbox-only), and their official Electron example registers a custom
// protocol — github.com/workos/electron-authkit-example.
//
// Delivery differs per OS:
//   - macOS: 'open-url' app event (works packaged and in dev once
//     LaunchServices has seen setAsDefaultProtocolClient).
//   - Windows/Linux: the OS launches a second instance with the URL as
//     an argv token; the single-instance lock forwards it to us via the
//     'second-instance' event.
// index.ts owns wiring those events to dispatchDeepLink; this module is
// electron-event-free so tests can drive it directly.

import { resolve } from 'node:path'

import { app } from 'electron'

export const DEEP_LINK_SCHEME = 'spool'

/** Return true to consume the URL (stops further listeners). */
type DeepLinkListener = (url: URL) => boolean

const listeners = new Set<DeepLinkListener>()

export function registerDeepLinkScheme(): void {
  if (process.defaultApp) {
    // Dev (`electron .`): the OS must be told the explicit executable +
    // entry script, or it routes the scheme at the bare Electron binary
    // with no app code loaded.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
        resolve(process.argv[1]!),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME)
  }
}

export function onDeepLink(listener: DeepLinkListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Returns true when a listener consumed the URL. */
export function dispatchDeepLink(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return false
  for (const listener of [...listeners]) {
    if (listener(url)) return true
  }
  return false
}

/** Windows/Linux deliver the URL as a plain argv token. */
export function dispatchDeepLinkFromArgv(argv: readonly string[]): boolean {
  const raw = argv.find((a) => a.startsWith(`${DEEP_LINK_SCHEME}://`))
  return raw ? dispatchDeepLink(raw) : false
}

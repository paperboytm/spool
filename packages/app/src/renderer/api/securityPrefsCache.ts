// Module-level cache for SecurityPreferences exposed via a
// useSyncExternalStore hook. Mirrors the pattern in `featureFlags.ts`
// (useFeature) — that's the React-18-blessed shape for "external,
// non-React state that components read synchronously".
//
// Why a cache at all: every "Settings → Security" open used to mount
// Toggle controls with a `?? false` fallback before the async
// getPrefs resolved, causing a visible off→on sweep on every tab
// open. With the cache primed early in app boot, by the time a user
// can click Settings the prefs are already in memory and every
// Toggle renders with its final state from frame 1.
//
// Priming is decoupled from this module's import: App.tsx calls
// `primeSecurityPrefsCache()` from a useEffect at mount, so the
// dependency is visible at the call site instead of being a hidden
// side-effect of importing the file. Late callers (components that
// mount before the prime resolves) still get a synchronous null and
// can render a same-size placeholder to keep layout stable until
// the subscription delivers the first value.

import { useSyncExternalStore } from 'react'
import { securityApi, type SecurityPreferences } from './security.js'

let cached: SecurityPreferences | null = null
let inflight: Promise<SecurityPreferences | null> | null = null
const subscribers = new Set<() => void>()

function emit(): void {
  for (const fn of subscribers) {
    try { fn() } catch (err) { console.error('[securityPrefsCache] subscriber threw:', err) }
  }
}

function getSnapshot(): SecurityPreferences | null {
  return cached
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

/** React hook. Returns the current cached SecurityPreferences, or
 *  null if the cache is cold. Re-renders when the cache changes
 *  (either from a primeSecurityPrefsCache resolve or an
 *  onPrefsChanged broadcast). */
export function useCachedSecurityPrefs(): SecurityPreferences | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Optimistically merge a patch into the cache, broadcast to
 *  subscribers, and persist via setPrefs. Callers that want the
 *  toggle to flip instantly on click (i.e. before the IPC roundtrip
 *  completes) use this instead of calling setPrefs directly. The
 *  main-process EVT_PREFS_CHANGED reply still lands in the cache,
 *  but by then the user already sees the new state. */
export async function patchSecurityPrefs(patch: Partial<SecurityPreferences>): Promise<void> {
  if (cached) {
    cached = { ...cached, ...patch }
    emit()
  }
  try { await securityApi.setPrefs(patch) }
  catch (err) { console.error('[securityPrefsCache] setPrefs failed:', err) }
}

/** Idempotent prefetch. Call once at app boot (from an App-level
 *  useEffect). Subsequent calls return the cached value. Also lazily
 *  attaches the upstream onPrefsChanged listener — see comment below. */
export async function primeSecurityPrefsCache(): Promise<SecurityPreferences | null> {
  ensureUpstreamSubscription()
  if (cached) return cached
  if (inflight) return inflight
  inflight = securityApi.getPrefs()
    .then((p) => {
      cached = p
      inflight = null
      emit()
      return p
    })
    .catch(() => {
      inflight = null
      return null
    })
  return inflight
}

// Keep the cache live across the app session. The main-process side
// broadcasts EVT_PREFS_CHANGED on every saveSecurityPreferences, so
// any toggle flipped from another window or from main itself updates
// every subscriber here.
//
// CRITICAL: do NOT call `securityApi.onPrefsChanged` (or any window.spool.*
// accessor) at module top level. Spool runs a hidden PF inference
// window with its own minimal preload that does NOT expose
// `window.spool`; in dev, Vite HMR rebroadcasts module evaluations
// across every connected client, so a top-level access here would
// crash the inference window on every renderer HMR — which in turn
// stalls `pfRuntime.start()`, leaves `pfOnline = false`, and silently
// downgrades every Security rescan to regex-only. Subscribing inside
// `primeSecurityPrefsCache` (called from the main window's App.tsx)
// keeps the listener scoped to a window that actually has the
// security IPC bridge.
let subscriptionAttached = false
function ensureUpstreamSubscription(): void {
  if (subscriptionAttached) return
  if (typeof window === 'undefined' || !window.spool?.security?.onPrefsChanged) return
  subscriptionAttached = true
  securityApi.onPrefsChanged((next) => {
    cached = next
    emit()
  })
}

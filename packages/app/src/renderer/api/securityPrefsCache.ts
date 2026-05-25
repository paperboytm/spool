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
 *  useEffect). Subsequent calls return the cached value. */
export async function primeSecurityPrefsCache(): Promise<SecurityPreferences | null> {
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
// every subscriber here. This subscription is the one piece of
// implicit module-level behaviour we accept: it's a single static
// listener that never grows, and removing it would silently break
// "open Settings, change pref, immediately switch tabs without
// closing Settings".
securityApi.onPrefsChanged((next) => {
  cached = next
  emit()
})

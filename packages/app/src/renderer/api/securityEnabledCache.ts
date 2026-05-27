// Module-level mirror of the user's Security opt-in (`agents.json`
// `securityEnabled`), exposed via useSyncExternalStore so every Security
// surface can gate synchronously without prop-drilling the config.
//
// This rides the GENERAL app config (always-available `spool:ai-config`
// IPC), NOT the Security prefs IPC — the whole point is to be readable
// while the Security feature (and its IPC bridge) is OFF. App.tsx seeds
// it on config load and updates it when the Labs toggle flips.
//
// Tri-state: `undefined` = the user has made no explicit choice, so the
// resolver in featureFlags falls back to DEV. `true`/`false` are
// explicit opt-in / opt-out.

import { useSyncExternalStore } from 'react'

let configValue: boolean | undefined = undefined
const subscribers = new Set<() => void>()

export function setSecurityEnabledConfig(next: boolean | undefined): void {
  if (configValue === next) return
  configValue = next
  for (const fn of subscribers) {
    try { fn() } catch (err) { console.error('[securityEnabledCache] subscriber threw:', err) }
  }
}

export function getSecurityEnabledConfig(): boolean | undefined {
  return configValue
}

function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => { subscribers.delete(fn) }
}

/** React hook over the cached opt-in value. Components combine this with
 *  the static build-capability check via `useSecurityEnabled()` in
 *  featureFlags. */
export function useSecurityEnabledConfig(): boolean | undefined {
  return useSyncExternalStore(subscribe, getSecurityEnabledConfig, getSecurityEnabledConfig)
}

/** Test-only. */
export function __resetSecurityEnabledCacheForTest(seed: boolean | undefined = undefined): void {
  configValue = seed
  subscribers.clear()
}

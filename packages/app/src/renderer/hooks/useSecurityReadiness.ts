import { useEffect, useState } from 'react'
import { securityApi, type SecurityReadiness } from '../api/security.js'

/** Tracks the main-process scan-worker boot state.
 *
 *  Returns `{ ready: false, reason: 'booting' }` while the worker is
 *  still spawning (covers the IPC race when Settings → Security opens
 *  during boot) and `{ ready: false, reason: 'scanner-unavailable' }`
 *  if the worker failed to spawn (e.g. better-sqlite3 native binding
 *  mis-built). Components use this to gate worker-dependent IPC calls
 *  and to render a banner instead of swallowing "No handler
 *  registered" errors.
 *
 *  The initial value is `booting` so the first render never tries a
 *  worker-dependent call before the async getReadiness resolves. */
export function useSecurityReadiness(): SecurityReadiness {
  const [readiness, setReadiness] = useState<SecurityReadiness>({ ready: false, reason: 'booting' })
  useEffect(() => {
    let cancelled = false
    void securityApi.getReadiness().then((r) => {
      if (!cancelled) setReadiness(r)
    }).catch(() => {
      // Eager registration means this rejection only happens if the
      // feature flag is off — leave the initial 'booting' state in
      // place; the parent feature-flag gate keeps the surface hidden.
    })
    const off = securityApi.onReadinessChanged((next) => {
      setReadiness(next)
    })
    return () => { cancelled = true; off() }
  }, [])
  return readiness
}

import { fetchMe } from './api'
import { clearCachedAuthIf, type AuthIdentity, getCachedAuth, setCachedAuth } from './auth-cache'
import { readCachedMe } from './me-cache'

export type AuthState = AuthIdentity | 'auto'

/**
 * Resolve the lightweight identity used by every Web header.
 *
 * The promise is shared across the marketing and product chrome so moving
 * between `/docs`, `/explore`, and `/me` does not fan out duplicate `/api/me`
 * requests. Authorization still comes from the server; this identity only
 * controls which account affordance the header renders.
 */
export async function resolveAuthState(): Promise<AuthIdentity> {
  const existing = getCachedAuth()
  if (existing) return existing

  let pending: Promise<AuthIdentity> | null = null
  pending = (async () => {
    const result = await fetchMe()
    if (result.kind === 'ok') {
      return { name: result.me.display_name, src: result.me.avatar_url } as AuthIdentity
    }

    if (result.kind === 'unauthenticated') return 'out'

    // A 403 recovery surface or a transient fetch failure does not prove the
    // user signed out. Keep a previously verified identity visible and make
    // the next resolver call retry. The identity write in a concurrent
    // successful fetch wins because the conditional clear cannot erase it.
    const stale = readCachedMe()
    if (pending) clearCachedAuthIf(pending)
    return stale ? { name: stale.name, src: stale.avatar_url } : 'out'
  })()
  setCachedAuth(pending)
  return pending
}

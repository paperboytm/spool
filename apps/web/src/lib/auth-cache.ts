// Primitive state holder for the cross-Header auth memo. No imports
// from `api.ts` so `api.ts` can call `invalidateAuthCache()` on
// sign-out / 401 without creating a circular module graph. The
// `resolveAuthState` wrapper that actually calls `fetchMe` lives in
// `components/Chrome.tsx`.

export type AuthIdentity = 'out' | { name: string | null; src: string | null }

export const AUTH_IDENTITY_CHANGED = 'spool:auth-identity-changed' as const

declare global {
  interface WindowEventMap {
    [AUTH_IDENTITY_CHANGED]: CustomEvent<AuthIdentity>
  }
}

let cached: Promise<AuthIdentity> | null = null

export function getCachedAuth(): Promise<AuthIdentity> | null {
  return cached
}

export function setCachedAuth(p: Promise<AuthIdentity> | null): void {
  cached = p
}

/** Replace the resolved identity memo and notify every mounted Header.
 * Profile mutations use this path after /api/me revalidates so the account
 * avatar and display name change without requiring a document reload. */
export function setResolvedAuthIdentity(identity: AuthIdentity): void {
  cached = Promise.resolve(identity)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_IDENTITY_CHANGED, { detail: identity }))
  }
}

/** Drop the in-flight / resolved auth memo. Called from `api.ts`'s
 *  `signOut` and from `fetchMe`'s 401 path so the next Header mount
 *  refetches `/api/me` instead of resolving against the stale promise. */
export function invalidateAuthCache(): void {
  cached = null
}

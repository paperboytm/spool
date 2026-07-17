// Primitive state holder for the cross-Header auth memo. No imports
// from `api.ts` so `api.ts` can call `invalidateAuthCache()` on
// sign-out / 401 without creating a circular module graph. The
// `resolveAuthState` wrapper that actually calls `fetchMe` lives in
// `components/Chrome.tsx`.

export type AuthIdentity =
  | 'out'
  | { name: string | null; src: string | null }

let cached: Promise<AuthIdentity> | null = null

export function getCachedAuth(): Promise<AuthIdentity> | null {
  return cached
}

export function setCachedAuth(p: Promise<AuthIdentity>): void {
  cached = p
}

/** Drop the in-flight / resolved auth memo. Called from `api.ts`'s
 *  `signOut` and from `fetchMe`'s 401 path so the next Header mount
 *  refetches `/api/me` instead of resolving against the stale promise. */
export function invalidateAuthCache(): void {
  cached = null
}

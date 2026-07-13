/// <reference types="vite/client" />

/**
 * Pure resolver for the share-publish gate. Split out from the hook
 * `useSharePublish` so unit tests can drive the decision without
 * stubbing `import.meta.env`.
 *
 * Why this gate is a build-time env var and not a runtime toggle:
 *  - Pre-launch we don't want this surface exposed to contributors
 *    poking around dev builds.
 *  - The flag is purely a build-time concern (Vite inlines the env
 *    value, prod builds don't define it) so a localStorage tri-state
 *    adds no value and only creates a "stale override pinned the flag
 *    off and I had to remember to clear it" DX trap.
 *  - DEV does NOT default this on. Contributors who don't actively
 *    work on share-publish shouldn't see the half-finished surface
 *    just for running `pnpm dev`. Opt in by adding
 *    `VITE_FEATURE_SHAREPUBLISH=1` to packages/app/.env.development.local
 *    (gitignored).
 *
 * At GA the body of `useSharePublish` becomes `return true` (or this
 * helper is removed) — single source of truth, no scattered
 * envEnabled calls.
 */
export function resolveSharePublish(
  env: Record<string, string | undefined>,
): boolean {
  return env['VITE_FEATURE_SHAREPUBLISH'] === '1'
}

export function useSharePublish(): boolean {
  return resolveSharePublish(
    import.meta.env as Record<string, string | undefined>,
  )
}

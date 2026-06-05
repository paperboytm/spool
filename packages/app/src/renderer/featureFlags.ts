/// <reference types="vite/client" />

import { useSyncExternalStore } from 'react'
import {
  getLabsFlag,
  subscribeLabsFlag,
  type LabsFlag,
} from './lib/labsFlags.js'
import { useSecurityEnabledConfig } from './api/securityEnabledCache.js'

// Resolution order: explicit user choice (Labs) > explicit env var > DEV
// default per-flag. Labs explicit "0" can always turn a feature OFF —
// this is the user's escape hatch from a DEV / env that would otherwise
// pin it on.
//
//   share — Phase 0 editor, already shipped on main; DEV on by default
//   so contributors don't have to opt in just to see existing UI.
//
// `sharePublish` is intentionally NOT a LabsFlag — see useSharePublish
// below. Pre-launch we gate that surface purely on a build-time env var
// so it stays out of the Labs UI for other contributors.
const DEV_DEFAULT_ON: Record<LabsFlag, boolean> = {
  share: true,
}

export interface FeatureRuntimeDeps {
  dev: boolean
  envEnabled: (envKey: string) => boolean
  labsValue: (flag: LabsFlag) => boolean | null
}

const defaultDeps: FeatureRuntimeDeps = {
  dev: import.meta.env.DEV,
  envEnabled: (key) =>
    (import.meta.env as Record<string, string | undefined>)[`VITE_FEATURE_${key}`] === '1',
  labsValue: getLabsFlag,
}

export function resolveFeatureRuntime(
  flag: LabsFlag,
  deps: FeatureRuntimeDeps = defaultDeps,
): boolean {
  const labs = deps.labsValue(flag)
  if (labs !== null) return labs
  if (deps.envEnabled(flag.toUpperCase())) return true
  return deps.dev && DEV_DEFAULT_ON[flag]
}

/**
 * Pure resolver for the share-publish gate. Split out from the hook
 * `useSharePublish` so unit tests can drive the decision without
 * stubbing `import.meta.env`.
 *
 * Why this gate isn't a LabsFlag:
 *  - Pre-launch we don't want this surface exposed via the Labs UI to
 *    other contributors poking around dev builds.
 *  - The flag is purely a build-time concern (Vite inlines the env
 *    value, prod builds don't define it) so a localStorage tri-state
 *    adds no value and only creates a "stale labs override pinned the
 *    flag off and I had to remember to clear it" DX trap.
 *  - DEV does NOT default this on. Contributors who don't actively
 *    work on share-publish shouldn't see the half-finished surface
 *    just for running `pnpm dev`. Opt in by adding
 *    `VITE_FEATURE_SHAREPUBLISH=1` to packages/app/.env.development.local
 *    (gitignored).
 *
 * At GA the body of `useSharePublish` becomes `return true` (or this
 * helper is removed) — single source of truth, no labs row, no
 * scattered envEnabled calls.
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

export function useFeature(flag: LabsFlag): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeLabsFlag(flag, onChange),
    () => resolveFeatureRuntime(flag),
    () => resolveFeatureRuntime(flag),
  )
}

// Security Scan gating has two layers:
//
//   1. BUILD capability (static, dead-code-eliminable): is the Security
//      code even compiled into this bundle? True in dev and in builds
//      compiled with VITE_FEATURE_SECURITY=1. When false, Vite/terser
//      strips every guarded branch, so production builds that don't opt
//      in ship none of the Security surface or worker.
//
//   2. RUNTIME opt-in (Labs): has the user turned it on? Stored on the
//      general `agents.json` config (`securityEnabled`) so BOTH the
//      renderer and the main-process scan worker can read it — unlike
//      the localStorage LabsFlags, which the main process can't see.
//
// A surface is live iff (1) AND (2). The runtime value is tri-state:
// `undefined` (no choice) falls back to DEV, so dev keeps showing the
// feature without an explicit opt-in.
export function securityBuildCapable(deps: Pick<FeatureRuntimeDeps, 'dev' | 'envEnabled'> = defaultDeps): boolean {
  return deps.dev || deps.envEnabled('SECURITY')
}

/** Pure resolver: build-capable AND the user opted in (or DEV default). */
export function resolveSecurityEnabled(
  configValue: boolean | undefined,
  deps: Pick<FeatureRuntimeDeps, 'dev' | 'envEnabled'> = defaultDeps,
): boolean {
  return securityBuildCapable(deps) && (configValue ?? deps.dev)
}

/** React hook every Security surface uses to gate itself. Reactive to
 *  the Labs toggle via the shared opt-in cache. */
export function useSecurityEnabled(): boolean {
  return resolveSecurityEnabled(useSecurityEnabledConfig())
}

/// <reference types="vite/client" />

import { useSyncExternalStore } from 'react'
import {
  getLabsFlag,
  subscribeLabsFlag,
  type LabsFlag,
} from './lib/labsFlags.js'
import { useSecurityEnabledConfig } from './api/securityEnabledCache.js'

// Resolution order: explicit user choice (Labs) wins over DEV / env.
// This is what makes Labs feel consistent — a user can turn a feature
// off even when DEV or VITE_FEATURE_<NAME> would otherwise pin it on.

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
  return deps.dev || deps.envEnabled(flag.toUpperCase())
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

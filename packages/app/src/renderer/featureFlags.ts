/// <reference types="vite/client" />

import { useSyncExternalStore } from 'react'
import {
  getLabsFlag,
  subscribeLabsFlag,
  type LabsFlag,
} from './lib/labsFlags.js'

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

// Security Scan is intentionally NOT in the LabsFlag union — we don't
// want users opting into it manually until the worker + UI surfaces
// ship. Resolution: dev → true; prod → true only when release.sh sets
// VITE_FEATURE_SECURITY. No Labs override.
export function securityFeatureEnabled(deps: Pick<FeatureRuntimeDeps, 'dev' | 'envEnabled'> = defaultDeps): boolean {
  return deps.dev || deps.envEnabled('SECURITY')
}

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resolveFeatureRuntime,
  resolveSharePublish,
  type FeatureRuntimeDeps,
} from './featureFlags.js'
import { __resetLabsFlagsForTest } from './lib/labsFlags.js'
import { MemoryStorage } from './lib/__test__/memoryStorage.js'

const off: FeatureRuntimeDeps = {
  dev: false,
  envEnabled: () => false,
  labsValue: () => null,
}

beforeEach(() => {
  __resetLabsFlagsForTest(new MemoryStorage())
})

describe('resolveFeatureRuntime', () => {
  it('returns false when all sources are off (no opinion)', () => {
    expect(resolveFeatureRuntime('share', off)).toBe(false)
  })

  it('returns true when DEV is on and no labs opinion', () => {
    expect(resolveFeatureRuntime('share', { ...off, dev: true })).toBe(true)
  })

  it('returns true when env flag is set and no labs opinion', () => {
    expect(resolveFeatureRuntime('share', { ...off, envEnabled: (k) => k === 'SHARE' })).toBe(true)
  })

  it('returns true when labs is explicitly enabled', () => {
    expect(resolveFeatureRuntime('share', { ...off, labsValue: () => true })).toBe(true)
  })

  it('labs explicit OFF beats DEV ON (user choice wins)', () => {
    expect(resolveFeatureRuntime('share', { ...off, dev: true, labsValue: () => false })).toBe(false)
  })

  it('labs explicit OFF beats env ON (user choice wins)', () => {
    expect(resolveFeatureRuntime('share', {
      ...off,
      envEnabled: (k) => k === 'SHARE',
      labsValue: () => false,
    })).toBe(false)
  })

  it('labs explicit ON wins even when DEV / env are off', () => {
    expect(resolveFeatureRuntime('share', { ...off, labsValue: () => true })).toBe(true)
  })

  it('upper-cases the flag name when consulting env', () => {
    const seen: string[] = []
    resolveFeatureRuntime('share', { ...off, envEnabled: (k) => { seen.push(k); return false } })
    expect(seen).toEqual(['SHARE'])
  })

})

describe('resolveSharePublish', () => {
  // sharePublish is intentionally NOT a LabsFlag — it's a pure
  // build-time env gate that Vite inlines. The resolver takes the env
  // map directly so tests don't have to stub `import.meta.env`.

  it('returns false when the env var is absent', () => {
    expect(resolveSharePublish({})).toBe(false)
  })

  it('returns false when the env var is set to anything other than "1"', () => {
    expect(resolveSharePublish({ VITE_FEATURE_SHAREPUBLISH: '0' })).toBe(false)
    expect(resolveSharePublish({ VITE_FEATURE_SHAREPUBLISH: 'true' })).toBe(false)
    expect(resolveSharePublish({ VITE_FEATURE_SHAREPUBLISH: '' })).toBe(false)
  })

  it('returns true ONLY for the exact string "1"', () => {
    expect(resolveSharePublish({ VITE_FEATURE_SHAREPUBLISH: '1' })).toBe(true)
  })

  it('does NOT auto-enable in DEV', () => {
    // The gate exists to keep the pre-launch publish surface invisible
    // to contributors who haven't opted in. DEV alone is not enough.
    expect(resolveSharePublish({ DEV: 'true', MODE: 'development' })).toBe(false)
  })

  it('ignores unrelated env vars', () => {
    expect(
      resolveSharePublish({
        VITE_FEATURE_OTHER: '1',
        SHAREPUBLISH: '1',
        VITE_SHAREPUBLISH: '1',
      }),
    ).toBe(false)
  })
})

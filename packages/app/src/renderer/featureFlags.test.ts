import { describe, it, expect } from 'vitest'
import { resolveSharePublish } from './featureFlags.js'

describe('resolveSharePublish', () => {
  // sharePublish is a pure build-time env gate that Vite inlines.
  // The resolver takes the env map directly so tests don't have to
  // stub `import.meta.env`.

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

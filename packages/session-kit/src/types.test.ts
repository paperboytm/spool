import { describe, expect, it } from 'vite-plus/test'

import { isDiscoverySessionProvider, isDiscoverySessionSid } from './types.js'

describe('Discovery provider policy', () => {
  it.each(['claude', 'codex'])('publishes %s Sessions by default', (provider) => {
    expect(isDiscoverySessionProvider(provider)).toBe(true)
    expect(isDiscoverySessionSid(`${provider}_session-id`)).toBe(true)
  })

  it.each(['gemini', 'opencode', 'pi', 'zcode'])('keeps %s Sessions Link-only', (provider) => {
    expect(isDiscoverySessionProvider(provider)).toBe(false)
    expect(isDiscoverySessionSid(`${provider}_session-id`)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { AcpManager, applySecurityEnabledSeed } from './acp.js'

describe('AcpManager builtin agents', () => {
  it('includes Gemini CLI as a native ACP agent', () => {
    const manager = new AcpManager()
    const builtins = manager.getBuiltinAgents()

    expect(builtins['gemini']).toEqual({
      name: 'Gemini CLI',
      bin: 'gemini',
      acpMode: 'native',
    })
  })
})

describe('applySecurityEnabledSeed', () => {
  it('seeds true when there is no agents.json yet', () => {
    expect(applySecurityEnabledSeed(null)).toEqual({
      changed: true,
      config: { securityEnabled: true },
    })
  })

  it('seeds true when the field is absent', () => {
    expect(applySecurityEnabledSeed({ defaultAgent: 'claude' })).toEqual({
      changed: true,
      config: { defaultAgent: 'claude', securityEnabled: true },
    })
  })

  it('preserves an explicit opt-out', () => {
    expect(applySecurityEnabledSeed({ securityEnabled: false })).toEqual({
      changed: false,
      config: { securityEnabled: false },
    })
  })

  it('is a no-op when already true', () => {
    expect(applySecurityEnabledSeed({ securityEnabled: true })).toEqual({
      changed: false,
      config: { securityEnabled: true },
    })
  })

  it('does not mutate the input object', () => {
    const input = { defaultAgent: 'codex' }
    applySecurityEnabledSeed(input)
    expect(input).toEqual({ defaultAgent: 'codex' })
  })
})

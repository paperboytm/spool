import { describe, expect, it } from 'vite-plus/test'

import { AcpManager } from './acp.js'

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

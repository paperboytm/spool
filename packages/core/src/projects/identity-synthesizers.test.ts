import { describe, it, expect, beforeEach, afterEach } from 'vite-plus/test'

import { codexScratchSynthesizer } from './identity-synthesizers.js'

describe('codexScratchSynthesizer', () => {
  let originalHome: string | undefined

  beforeEach(() => {
    originalHome = process.env['HOME']
    process.env['HOME'] = '/Users/chen'
  })

  afterEach(() => {
    if (originalHome === undefined) delete process.env['HOME']
    else process.env['HOME'] = originalHome
  })

  it('matches Codex non-project chat workspaces', () => {
    const id = codexScratchSynthesizer.synthesize(
      '/Users/chen/Documents/Codex/2026-05-11/codex-project',
    )
    expect(id).toEqual({
      kind: 'synthetic',
      key: 'codex:scratch',
      displayName: 'Codex Chats',
      displayPath: '/Users/chen/Documents/Codex',
    })
  })

  it('returns the same key for any date or slug', () => {
    const a = codexScratchSynthesizer.synthesize('/Users/chen/Documents/Codex/2026-05-11/new-chat')
    const b = codexScratchSynthesizer.synthesize(
      '/Users/chen/Documents/Codex/2027-01-02/something-else',
    )
    expect(a?.key).toBe('codex:scratch')
    expect(b?.key).toBe('codex:scratch')
  })

  it('ignores cwds outside ~/Documents/Codex/', () => {
    expect(codexScratchSynthesizer.synthesize('/Users/chen/Code/spool')).toBeNull()
    expect(codexScratchSynthesizer.synthesize('/Users/chen/Documents/other')).toBeNull()
    // Documents/Codex itself (no trailing date dir) is not a scratch workspace.
    expect(codexScratchSynthesizer.synthesize('/Users/chen/Documents/Codex')).toBeNull()
  })

  it('honors $HOME override', () => {
    process.env['HOME'] = '/tmp/fake-home'
    expect(
      codexScratchSynthesizer.synthesize('/Users/chen/Documents/Codex/2026-05-11/x'),
    ).toBeNull()
    expect(
      codexScratchSynthesizer.synthesize('/tmp/fake-home/Documents/Codex/2026-05-11/x')?.key,
    ).toBe('codex:scratch')
  })
})

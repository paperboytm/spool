import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

import {
  AcpManager,
  actionableAcpError,
  createRestrictedPiCommand,
  resolveAcpExtensionEntry,
} from './acp.js'

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

  it('includes an installed Pi through its ACP adapter', () => {
    const manager = new AcpManager()
    const builtins = manager.getBuiltinAgents()

    expect(builtins['pi']).toEqual({
      name: 'Pi',
      bin: 'pi',
      acpMode: 'extension',
    })
  })
})

describe('ACP adapter resolution', () => {
  it('uses the current JavaScript Codex adapter instead of a stale platform wrapper', () => {
    const root = mkdtempSync(join(tmpdir(), 'spool-acp-resolution-'))
    try {
      const jsEntry = join(root, 'acp-extension-codex', 'dist', 'index.js')
      const staleNative = join(
        root,
        `acp-extension-codex-${process.platform}-${process.arch}`,
        'bin',
        'acp-extension-codex',
      )
      mkdirSync(join(jsEntry, '..'), { recursive: true })
      mkdirSync(join(staleNative, '..'), { recursive: true })
      writeFileSync(jsEntry, '')
      writeFileSync(staleNative, '')

      expect(resolveAcpExtensionEntry('codex', undefined, [root])).toBe(jsEntry)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves Pi through the pi-acp package', () => {
    const root = mkdtempSync(join(tmpdir(), 'spool-pi-acp-resolution-'))
    try {
      const entry = join(root, 'pi-acp', 'dist', 'index.js')
      mkdirSync(join(entry, '..'), { recursive: true })
      writeFileSync(entry, '')

      expect(resolveAcpExtensionEntry('pi', 'pi-acp', [root])).toBe(entry)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('disables Pi tools before forwarding summary-mode RPC arguments', () => {
    const command = createRestrictedPiCommand()
    try {
      const source = readFileSync(command.path, 'utf8')
      expect(source).toContain('--no-tools')
      expect(source.indexOf('--no-tools')).toBeLessThan(
        source.indexOf(process.platform === 'win32' ? '%*' : '"$@"'),
      )
    } finally {
      command.dispose()
    }
  })
})

describe('ACP errors', () => {
  it('surfaces the upstream model compatibility error instead of Internal error', () => {
    const stderr = `[acp-codex] Unhandled error during turn: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-sol' model requires a newer version of Codex."}} Some(Other)`

    expect(actionableAcpError('Internal error', stderr)).toBe(
      "The 'gpt-5.6-sol' model requires a newer version of Codex.",
    )
  })
})

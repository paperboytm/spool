import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect, afterEach, beforeEach } from 'vite-plus/test'

import { wellKnownBinPaths, nvmVersionBins, miseVersionBins } from './resolve-bin.js'

let tmpHome: string

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'spool-resolve-bin-'))
})

afterEach(() => {
  try {
    rmSync(tmpHome, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function touch(path: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '')
}

describe('wellKnownBinPaths', () => {
  it('includes standard install dirs in a stable order', () => {
    const paths = wellKnownBinPaths('codex', tmpHome)
    expect(paths).toContain('/usr/local/bin/codex')
    expect(paths).toContain('/opt/homebrew/bin/codex')
    expect(paths).toContain(`${tmpHome}/.local/bin/codex`)
  })

  it('puts extras before defaults so callers can override', () => {
    const paths = wellKnownBinPaths('codex', tmpHome, ['/custom/codex'])
    expect(paths[0]).toBe('/custom/codex')
  })

  it('appends mise shim path', () => {
    const paths = wellKnownBinPaths('codex', tmpHome)
    expect(paths).toContain(`${tmpHome}/.local/share/mise/shims/codex`)
  })
})

describe('nvmVersionBins', () => {
  it('returns empty when nvm dir is missing', () => {
    expect(nvmVersionBins(tmpHome, 'node')).toEqual([])
  })

  it('lists installed node versions newest first', () => {
    const base = join(tmpHome, '.nvm', 'versions', 'node')
    mkdirSync(join(base, 'v18.0.0'), { recursive: true })
    mkdirSync(join(base, 'v20.5.0'), { recursive: true })
    mkdirSync(join(base, 'v22.1.0'), { recursive: true })
    const bins = nvmVersionBins(tmpHome, 'node')
    expect(bins).toEqual([
      join(base, 'v22.1.0', 'bin', 'node'),
      join(base, 'v20.5.0', 'bin', 'node'),
      join(base, 'v18.0.0', 'bin', 'node'),
    ])
  })

  it('skips non-version entries', () => {
    const base = join(tmpHome, '.nvm', 'versions', 'node')
    mkdirSync(join(base, 'v20.0.0'), { recursive: true })
    mkdirSync(join(base, 'alias'), { recursive: true })
    expect(nvmVersionBins(tmpHome, 'node')).toEqual([join(base, 'v20.0.0', 'bin', 'node')])
  })
})

describe('miseVersionBins', () => {
  it('returns only the shim path when mise installs dir is missing', () => {
    expect(miseVersionBins(tmpHome, 'codex')).toEqual([`${tmpHome}/.local/share/mise/shims/codex`])
  })

  it('includes shim + installed versions, with latest first when present', () => {
    const installs = join(tmpHome, '.local', 'share', 'mise', 'installs', 'npm-openai-codex')
    mkdirSync(join(installs, '0.1.0'), { recursive: true })
    mkdirSync(join(installs, '0.2.0'), { recursive: true })
    mkdirSync(join(installs, 'latest'), { recursive: true })
    const bins = miseVersionBins(tmpHome, 'codex')
    expect(bins[0]).toBe(`${tmpHome}/.local/share/mise/shims/codex`)
    expect(bins[1]).toBe(join(installs, 'latest', 'bin', 'codex'))
    expect(bins.slice(2)).toEqual([
      join(installs, '0.2.0', 'bin', 'codex'),
      join(installs, '0.1.0', 'bin', 'codex'),
    ])
  })

  it('handles multiple plugins independently', () => {
    const root = join(tmpHome, '.local', 'share', 'mise', 'installs')
    mkdirSync(join(root, 'npm-openai-codex', 'latest'), { recursive: true })
    mkdirSync(join(root, 'node', '20.0.0'), { recursive: true })
    const bins = miseVersionBins(tmpHome, 'codex')
    expect(bins).toContain(join(root, 'npm-openai-codex', 'latest', 'bin', 'codex'))
    expect(bins).toContain(join(root, 'node', '20.0.0', 'bin', 'codex'))
  })

  it('reproduces issue #237: mise-installed codex is discoverable via fallback', () => {
    const codexPath = join(
      tmpHome,
      '.local',
      'share',
      'mise',
      'installs',
      'npm-openai-codex',
      'latest',
      'bin',
      'codex',
    )
    touch(codexPath)
    const paths = wellKnownBinPaths('codex', tmpHome)
    expect(paths).toContain(codexPath)
  })
})

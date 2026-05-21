import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pfInstallStatus } from './model-state.js'
import type { ModelManifest } from './model-manifest.js'

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

function manifest(files: { path: string; body: Buffer }[]): ModelManifest {
  return {
    hfRepo: 'r', hfCommit: 'c'.repeat(40),
    files: files.map(({ path, body }) => ({ path, sha256: sha256(body), sizeBytes: body.length })),
  }
}

let tmp: string
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), 'spool-pf-state-')) })
afterEach(() => { rmSync(tmp, { recursive: true, force: true }) })

describe('pfInstallStatus', () => {
  it('not-installed when no files are on disk', () => {
    const m = manifest([{ path: 'a.bin', body: Buffer.from('aaaa') }])
    expect(pfInstallStatus(tmp, m)).toEqual({ status: 'not-installed' })
  })

  it('installed when every file matches its SHA-256', () => {
    const a = Buffer.from('aaaa')
    const b = Buffer.from('bbbb')
    writeFileSync(join(tmp, 'a.bin'), a)
    writeFileSync(join(tmp, 'b.bin'), b)
    const m = manifest([{ path: 'a.bin', body: a }, { path: 'b.bin', body: b }])
    expect(pfInstallStatus(tmp, m)).toEqual({ status: 'installed' })
  })

  it('partial when at least one file is missing or a .part exists', () => {
    const a = Buffer.from('aaaa')
    const b = Buffer.from('bbbb')
    writeFileSync(join(tmp, 'a.bin'), a)
    writeFileSync(join(tmp, 'b.bin.part'), b.subarray(0, 2))
    const m = manifest([{ path: 'a.bin', body: a }, { path: 'b.bin', body: b }])
    const status = pfInstallStatus(tmp, m)
    expect(status.status).toBe('partial')
    if (status.status === 'partial') {
      expect(status.bytesPresent).toBe(a.length + 2)
      expect(status.bytesTotal).toBe(a.length + b.length)
    }
  })

  it('partial (not installed) when a file is on disk but its SHA disagrees', () => {
    const expected = Buffer.from('aaaa')
    const tampered = Buffer.from('xxxx')
    writeFileSync(join(tmp, 'a.bin'), tampered)
    const m = manifest([{ path: 'a.bin', body: expected }])
    expect(pfInstallStatus(tmp, m)).toEqual({ status: 'not-installed' })
  })
})

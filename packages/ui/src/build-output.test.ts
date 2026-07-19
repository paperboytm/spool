import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vite-plus/test'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')
const execFileAsync = promisify(execFile)

describe('package build output', () => {
  it('emits both exported CSS entrypoints', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'spool-ui-build-output-test-'))
    try {
      await execFileAsync('pnpm', ['exec', 'vp', 'build', '--outDir', outDir], {
        cwd: PACKAGE_ROOT,
      })

      expect(readFileSync(join(outDir, 'styles.css'), 'utf8')).toContain("@import './tokens.css'")
      expect(readFileSync(join(outDir, 'tokens.css'), 'utf8')).toContain('--sp-accent: #c85a00')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 30_000)
})

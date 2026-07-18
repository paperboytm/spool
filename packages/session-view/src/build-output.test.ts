import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vite-plus/test'

const PACKAGE_ROOT = resolve(__dirname, '..')
const OUT_DIR = mkdtempSync(join(tmpdir(), 'spool-session-view-build-output-test-'))
const execFileAsync = promisify(execFile)

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

describe('package build output', () => {
  it('emits the exported stylesheet during a Vite build', async () => {
    await execFileAsync('pnpm', ['exec', 'vite', 'build', '--outDir', OUT_DIR], {
      cwd: PACKAGE_ROOT,
    })

    const stylesheet = readFileSync(join(OUT_DIR, 'styles.css'), 'utf8')
    expect(stylesheet).toContain('.spool-md-scroll')
  }, 30_000)
})

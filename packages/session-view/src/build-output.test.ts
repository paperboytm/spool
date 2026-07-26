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
  it('uses the shared runtime tokens and Tailwind semantic theme', () => {
    const source = readFileSync(resolve(PACKAGE_ROOT, 'src/tailwind.css'), 'utf8')

    expect(source).toContain("@import '../../ui/src/css/tokens.css'")
    expect(source).toContain("@import '../../ui/src/css/theme.css'")
    expect(source).not.toContain('@theme')
    expect(source).not.toContain('--color-warm-bg:')
    expect(source).not.toContain('@custom-variant dark')
    expect(source).not.toContain('--spool-scrollbar')
  })

  it('emits the exported stylesheet during a Vite build', async () => {
    await execFileAsync('pnpm', ['exec', 'vp', 'build', '--outDir', OUT_DIR], {
      cwd: PACKAGE_ROOT,
    })

    const stylesheet = readFileSync(join(OUT_DIR, 'styles.css'), 'utf8')
    expect(stylesheet).toContain('.spool-md-scroll')
    expect(stylesheet).toContain('--color-background')
    expect(stylesheet).toContain('--sp-bg')
    expect(stylesheet).not.toContain('--color-warm-')
  }, 30_000)
})

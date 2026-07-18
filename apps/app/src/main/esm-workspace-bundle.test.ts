import { execFile } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vite-plus/test'

const APP_ROOT = resolve(__dirname, '..', '..')
const OUT_DIR = resolve(APP_ROOT, 'out-esm-workspace-bundle-check')
const ELECTRON_VITE = resolve(
  APP_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-vite.CMD' : 'electron-vite',
)
const execFileAsync = promisify(execFile)

const IMPORT_ONLY_WORKSPACE_PACKAGES = ['@spool-lab/cli/hub', '@spool-lab/session-kit']

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

describe('main-process ESM workspace bundles', () => {
  it('does not leave import-only packages behind as CommonJS requires', async () => {
    rmSync(OUT_DIR, { recursive: true, force: true })

    await execFileAsync(ELECTRON_VITE, ['build', '--outDir', OUT_DIR], {
      cwd: APP_ROOT,
      env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    })

    const bundle = readFileSync(join(OUT_DIR, 'main', 'index.mjs'), 'utf8')
    for (const packageName of IMPORT_ONLY_WORKSPACE_PACKAGES) {
      const hasRuntimeRequire =
        bundle.includes(`require("${packageName}")`) || bundle.includes(`require('${packageName}')`)
      expect(
        hasRuntimeRequire,
        `main bundle externalized import-only ${packageName} as a CommonJS require`,
      ).toBe(false)
    }
  }, 60_000)
})

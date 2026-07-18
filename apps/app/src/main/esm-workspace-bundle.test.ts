import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
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

    const mainEntry = join(OUT_DIR, 'main', 'index.mjs')
    const preloadEntry = join(OUT_DIR, 'preload', 'index.mjs')
    const inferencePreloadEntry = join(OUT_DIR, 'preload', 'inference.mjs')
    expect(existsSync(mainEntry), `expected ${mainEntry} to exist after build`).toBe(true)
    expect(existsSync(preloadEntry), `expected ${preloadEntry} to exist after build`).toBe(true)
    expect(
      existsSync(inferencePreloadEntry),
      `expected ${inferencePreloadEntry} to exist after build`,
    ).toBe(true)

    const bundle = readFileSync(mainEntry, 'utf8')
    expect(bundle).toContain('../preload/index.mjs')
    for (const packageName of IMPORT_ONLY_WORKSPACE_PACKAGES) {
      const hasRuntimeRequire =
        bundle.includes(`require("${packageName}")`) || bundle.includes(`require('${packageName}')`)
      expect(
        hasRuntimeRequire,
        `main bundle externalized import-only ${packageName} as a CommonJS require`,
      ).toBe(false)
    }

    for (const entry of [mainEntry, preloadEntry, inferencePreloadEntry]) {
      const output = readFileSync(entry, 'utf8')
      expect(output, `${entry} bundled Electron's npm downloader`).not.toContain(
        'Downloading Electron binary...',
      )
      expect(output, `${entry} bundled Electron's npm package`).not.toContain(
        'node_modules/.pnpm/electron@',
      )
      expect(output, `${entry} should import Electron from the runtime`).toMatch(
        /(?:from\s+|require\()['"]electron['"]\)?/,
      )
    }
  }, 60_000)
})

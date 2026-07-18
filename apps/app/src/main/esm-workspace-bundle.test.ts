import { execFile } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
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
const WORKER_CONFIG = resolve(APP_ROOT, 'electron.workers.vite.config.ts')
const execFileAsync = promisify(execFile)

const IMPORT_ONLY_WORKSPACE_PACKAGES = ['@spool-lab/cli/hub', '@spool-lab/session-kit']
const WORKER_ENTRIES = ['sync-worker.mjs', 'scan-worker-thread.mjs', 'mutation-worker-thread.mjs']

afterEach(() => {
  rmSync(OUT_DIR, { recursive: true, force: true })
})

describe('main-process ESM workspace bundles', () => {
  it('does not leave import-only packages behind as CommonJS requires', async () => {
    rmSync(OUT_DIR, { recursive: true, force: true })

    const buildEnv = {
      ...process.env,
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
      // Reproduce the graph that previously pulled an Electron-only auth
      // chunk into the scan worker through generated interop helpers.
      SPOOL_E2E_TEST: '1',
    }

    await execFileAsync(ELECTRON_VITE, ['build', '--outDir', OUT_DIR], {
      cwd: APP_ROOT,
      env: buildEnv,
    })
    await execFileAsync(ELECTRON_VITE, ['build', '--config', WORKER_CONFIG, '--outDir', OUT_DIR], {
      cwd: APP_ROOT,
      env: buildEnv,
    })

    const workerChunksDir = join(OUT_DIR, 'main', 'worker-chunks')
    const workerBundlePaths = [
      ...WORKER_ENTRIES.map((entry) => join(OUT_DIR, 'main', entry)),
      ...readdirSync(workerChunksDir).map((entry) => join(workerChunksDir, entry)),
    ]
    for (const workerBundlePath of workerBundlePaths) {
      const workerBundle = readFileSync(workerBundlePath, 'utf8')
      expect(workerBundle, 'worker bundle must not import Electron runtime APIs').not.toMatch(
        /from\s+['"]electron['"]/,
      )
      expect(workerBundle, 'worker bundle must not contain Electron npm code').not.toContain(
        'node_modules/.pnpm/electron@',
      )
    }

    const mainEntry = join(OUT_DIR, 'main', 'index.mjs')
    const preloadEntry = join(OUT_DIR, 'preload', 'index.js')
    const inferencePreloadEntry = join(OUT_DIR, 'preload', 'inference.js')
    expect(existsSync(mainEntry), `expected ${mainEntry} to exist after build`).toBe(true)
    expect(existsSync(preloadEntry), `expected ${preloadEntry} to exist after build`).toBe(true)
    expect(
      existsSync(inferencePreloadEntry),
      `expected ${inferencePreloadEntry} to exist after build`,
    ).toBe(true)
    for (const workerEntry of WORKER_ENTRIES) {
      const workerPath = join(OUT_DIR, 'main', workerEntry)
      expect(existsSync(workerPath), `expected ${workerPath} to exist after build`).toBe(true)
    }

    const bundle = readFileSync(mainEntry, 'utf8')
    expect(bundle).toContain('globalThis.__filename ??= import.meta.filename')
    expect(bundle).toContain('globalThis.__dirname ??= import.meta.dirname')
    expect(bundle).toContain('../preload/index.js')
    expect(bundle).not.toContain('../preload/index.mjs')
    for (const workerEntry of WORKER_ENTRIES) {
      expect(bundle, `main bundle should launch ${workerEntry}`).toContain(workerEntry)
      expect(bundle, `main bundle should not launch a .js build of ${workerEntry}`).not.toContain(
        workerEntry.replace(/\.mjs$/, '.js'),
      )
    }
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

    for (const entry of [preloadEntry, inferencePreloadEntry]) {
      const output = readFileSync(entry, 'utf8')
      expect(output, `${entry} must use CommonJS inside Electron's sandbox`).toMatch(
        /require\(['"]electron['"]\)/,
      )
      expect(output, `${entry} must not use ESM imports inside Electron's sandbox`).not.toMatch(
        /from\s+['"]electron['"]/,
      )
    }
  }, 60_000)
})

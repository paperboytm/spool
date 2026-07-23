import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, test } from 'vite-plus/test'

const repoRoot = new URL('../..', import.meta.url)

function read(path) {
  return readFileSync(new URL(path, repoRoot), 'utf8')
}

const rootManifest = JSON.parse(read('package.json'))
const legacyAppManifest = JSON.parse(read('apps/app/package.json'))
const workspace = read('pnpm-workspace.yaml')
const ciWorkflow = read('.github/workflows/ci.yml')
const rootConfig = read('vite.config.ts')
const localStack = read('scripts/share-dev.sh')
const lockfile = read('pnpm-lock.yaml')

describe('CLI + Web product boundary', () => {
  test('keeps Electron outside every active root command', () => {
    for (const script of [
      'package',
      'package:mac',
      'package:linux',
      'rebuild:native:electron',
      'dev:install:mac',
    ]) {
      expect(rootManifest.scripts).not.toHaveProperty(script)
    }

    expect(rootManifest.scripts['test:e2e']).toBe('pnpm --filter @spool/web test:e2e')
    expect(Object.values(rootManifest.scripts).join('\n')).not.toMatch(/electron|@spool\/app/i)
    expect(rootManifest.devDependencies).not.toHaveProperty('node-abi')
  })

  test('archives the Electron source outside workspace maintenance', () => {
    expect(workspace).toContain("- '!apps/app'")
    expect(workspace).not.toMatch(/^\s+electron:/m)
    expect(rootConfig).toContain("'apps/app/**'")
    expect(existsSync(new URL('apps/app/src/main/index.ts', repoRoot))).toBe(true)
    expect(read('apps/app/README.md')).toContain('historical implementation reference')
    expect(legacyAppManifest.scripts).toBeUndefined()
    expect(legacyAppManifest.build).toBeUndefined()
    expect(legacyAppManifest.devDependencies).not.toHaveProperty('electron-builder')
  })

  test('runs CI for CLI, Core, Backend, and Web without Electron E2E', () => {
    expect(ciWorkflow).toContain('name: CI')
    expect(ciWorkflow).toContain('os: [ubuntu-latest, macos-latest]')
    expect(ciWorkflow).toContain('pnpm --filter @spool-lab/core test')
    expect(ciWorkflow).toContain('pnpm --filter @spool-lab/cli test')
    expect(ciWorkflow).toContain('pnpm --filter @spool/backend test')
    expect(ciWorkflow).toContain('pnpm --filter @spool/web test')
    expect(ciWorkflow).toContain('pnpm test:e2e')
    expect(ciWorkflow).toContain('playwright install --with-deps chromium')
    expect(ciWorkflow).not.toMatch(/electron|@spool\/app|xvfb|apps\/app/i)
    expect(existsSync(new URL('.github/workflows/e2e.yml', repoRoot))).toBe(false)
  })

  test('removes package, signing, ABI, and local-install automation', () => {
    for (const path of [
      'apps/app/build/entitlements.mac.plist',
      'apps/app/build/notarize-dmg.js',
      'apps/app/scripts/package-size-report.mjs',
      'apps/app/scripts/smoke-packaged.mjs',
      'scripts/check-electron-native.cjs',
      'scripts/dev-install-mac.sh',
      'scripts/with-electron-native.mjs',
      'scripts/lib/electron-modules-abi.mjs',
      'scripts/lib/electron-modules-abi.test.mjs',
    ]) {
      expect(existsSync(new URL(path, repoRoot)), path).toBe(false)
    }
  })

  test('boots only Backend and Web for local publishing', () => {
    expect(localStack).toContain('share-backend')
    expect(localStack).toContain('http://localhost:3002')
    expect(localStack).not.toMatch(/electron|@spool\/app|apps\/app/i)
  })

  test('keeps Electron packages out of the install graph', () => {
    expect(lockfile).not.toMatch(/^\s{2}apps\/app:/m)
    expect(lockfile).not.toMatch(
      /^\s{2}(?:electron|electron-builder|electron-vite|electron-updater)@/m,
    )
    expect(lockfile).not.toMatch(/^\s{2}'@electron\//m)
  })
})

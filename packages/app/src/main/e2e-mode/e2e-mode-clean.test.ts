// Production-bundle invariant: when electron-vite builds the main
// process WITHOUT SPOOL_E2E_TEST set, the resulting bundle must contain
// NO trace of the e2e-mode/ entry. That's the entire point of using a
// build-time `__SPOOL_E2E__` define + dynamic import + dead-code
// elimination — the swap seam in session-store.ts exists, but no caller
// of it appears in the production binary, and the e2e mode entry isn't
// even resolved by rollup. This test enforces the invariant.
//
// Failure modes this catches:
//   - Someone adds a runtime `if (process.env.SPOOL_E2E_TEST === '1')`
//     check directly into production source — the bundled output would
//     contain the literal 'SPOOL_E2E_TEST' or 'e2e-fake-id-token'
//   - Someone forgets the dynamic-import pattern and statically imports
//     share-auth-e2e from main/index.ts — the e2e module is bundled
//     even with the build-time guard
//   - Someone changes the electron-vite config to leave __SPOOL_E2E__
//     undefined — terser can't strip the if-branch and the test code
//     ships
//
// The test does its own build into a tmp out/ to avoid touching the
// shared out/ tree (which test:e2e may have populated with a flagged
// build).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_ROOT = resolve(__dirname, '..', '..', '..')
const OUT_DIR = resolve(APP_ROOT, 'out-e2e-clean-check')

const FORBIDDEN_TOKENS = [
  // Strings unique to share-auth-e2e.ts. If any of these survive into
  // the production bundle, the dead-code-elimination guarantee is
  // broken and prod users carry an in-memory token store + fake-id-
  // token POST around as latent code.
  'e2e-fake-id-token',
  'registerShareAuthIpcForE2E',
  'share-auth-e2e',
]

describe('production bundle is free of e2e-mode/', () => {
  it('main/index.js contains zero references to the e2e composition root', () => {
    // Clean any prior tmp out before building so we're never grepping a
    // stale file from a previous test run.
    rmSync(OUT_DIR, { recursive: true, force: true })

    // Build WITHOUT SPOOL_E2E_TEST — production posture. Use a tmp
    // output dir so this test never clobbers the working out/ used by
    // dev or e2e runs.
    //
    // Why we shell out: electron-vite's programmatic API requires
    // module-resolution from a packaged Vite version, and vitest's
    // ESM loader doesn't play well with it. The shell-out is ~3s,
    // well inside the unit-test budget.
    const env = { ...process.env }
    delete env['SPOOL_E2E_TEST']
    execFileSync(
      'npx',
      [
        'electron-vite',
        'build',
        '--outDir',
        OUT_DIR,
      ],
      {
        cwd: APP_ROOT,
        env,
        stdio: 'pipe',
      },
    )

    const bundlePath = join(OUT_DIR, 'main', 'index.js')
    expect(existsSync(bundlePath), `expected ${bundlePath} to exist after build`).toBe(true)

    const bundle = readFileSync(bundlePath, 'utf8')
    for (const token of FORBIDDEN_TOKENS) {
      expect(
        bundle.includes(token),
        `production bundle contains forbidden e2e-mode token "${token}" — ` +
          `the build-time __SPOOL_E2E__ dead-code elimination is broken. ` +
          `Check electron.vite.config.ts:define and that main/index.ts uses ` +
          `if (__SPOOL_E2E__) { await import(...) } pattern (not a static import).`,
      ).toBe(false)
    }

    rmSync(OUT_DIR, { recursive: true, force: true })
  }, 60_000)
})

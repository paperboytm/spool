import { test, expect } from '@playwright/test'
import { launchApp } from './helpers/launch.js'

/**
 * Guard against main-process event-loop stalls on cold launch.
 *
 * A blocking call on the main-process JS thread (sync child_process,
 * sync big-file I/O, an unbroken JSON.parse on a huge blob) shows up
 * to the user as a beachball / spinning pinwheel within seconds of
 * opening the app. v0.4.17 shipped one such stall via the agent-binary
 * resolver — the perf branch that ships this test is the fix.
 *
 * The test does not enumerate offenders; it measures the symptom
 * directly via `node:perf_hooks.monitorEventLoopDelay`, which is
 * already started in `main/index.ts` and surfaced through a
 * test-only global when `SPOOL_E2E_TEST=1`.
 *
 * Two thresholds, on purpose:
 *   - the p99 bound catches drift in the typical launch experience
 *   - the max bound is the absolute beachball red line
 *
 * Both are intentionally permissive — CI runners are slow and GC
 * jitter is real. The point is to catch ≥1s stalls (the v0.4.17
 * regression class measured in seconds), not to police micro-stutter.
 *
 * macOS CI gets wider bounds than everywhere else. GitHub's shared
 * macOS runners have been observed at 314-584ms p99 / 624-1376ms max
 * across 2026-07-07's runs (and ~200-450ms p99 historically) with no
 * code-side regression — retries land on an already-hot runner and
 * read even worse. The tight bounds stay in force on ubuntu CI and
 * local runs, and the widened macOS bounds still catch the
 * seconds-long sync-blocking stalls this test exists for.
 *
 * `launchApp` creates a fresh `SPOOL_HOME` per test, so the on-disk
 * binary-resolve cache is empty here. That is exactly the cold-cache
 * scenario where the regression manifests; with the cache populated
 * a regression in cachedResolve could go undetected. Keep this test
 * cold.
 */

type LagSnapshot = {
  uptimeMs: number
  maxMs: number
  p99Ms: number
  meanMs: number
  count: number
}

const IS_MACOS_CI = process.platform === 'darwin' && !!process.env['CI']
const P99_LIMIT_MS = IS_MACOS_CI ? 600 : 300
const MAX_LIMIT_MS = IS_MACOS_CI ? 2000 : 1000

test('main-process event loop does not stall on cold launch', async () => {
  const ctx = await launchApp()
  try {
    // Wait for the renderer to be interactive — that's the window in
    // which a regressed sync IPC handler would stall things.
    await ctx.window.waitForLoadState('domcontentloaded')
    await ctx.window.waitForSelector('[data-testid="library-landing"], [data-testid="library-empty"], [data-testid="shares-page"]', {
      timeout: 15_000,
    })

    // Give the mount-time IPC storm and any background warm-up a
    // chance to clear before we read the histogram — otherwise we
    // miss what we're actually trying to catch.
    await ctx.window.waitForTimeout(2000)

    const lag = await ctx.app.evaluate(() => {
      const fn = (globalThis as { __spoolEventLoopLag?: () => LagSnapshot }).__spoolEventLoopLag
      if (!fn) throw new Error('event-loop monitor global not installed; is SPOOL_E2E_TEST=1?')
      return fn()
    })

    console.log('[startup-no-beachball] event-loop lag:', lag)

    expect(lag.count, 'lag monitor took at least one sample').toBeGreaterThan(0)
    expect(lag.p99Ms, 'p99 main-thread stall during launch').toBeLessThan(P99_LIMIT_MS)
    expect(lag.maxMs, 'absolute beachball red line').toBeLessThan(MAX_LIMIT_MS)
  } finally {
    await ctx.cleanup()
  }
})

import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

// Regression test for a white flash visible at the window edge during
// live drag-resize in dark mode. The renderer's React surface paints
// `dark:bg-dark-bg` on its root <div>, but the html element below it
// used to have a hardcoded `background: #FAFAF8`. On macOS the freshly
// exposed strip during a live resize sits one frame behind the React
// paint, so the html background showed through as a bright edge.
//
// Fix: `:root` now uses `var(--color-warm-bg)` and is overridden under
// `prefers-color-scheme: dark` to `var(--color-dark-bg)`. This test
// locks that in by asserting the computed html background follows the
// emulated color scheme.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('html root background tracks color-scheme (no white flash on resize)', async () => {
  await ctx.window.emulateMedia({ colorScheme: 'dark' })
  const darkBg = await ctx.window.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  )
  // --color-dark-bg = #141410 = rgb(20, 20, 16)
  expect(darkBg).toBe('rgb(20, 20, 16)')

  await ctx.window.emulateMedia({ colorScheme: 'light' })
  const lightBg = await ctx.window.evaluate(
    () => getComputedStyle(document.documentElement).backgroundColor,
  )
  // --color-warm-bg = #FAFAF8 = rgb(250, 250, 248)
  expect(lightBg).toBe('rgb(250, 250, 248)')
})

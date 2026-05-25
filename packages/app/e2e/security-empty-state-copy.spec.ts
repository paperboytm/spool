import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// Regression for the EmptyState copy split: when no scan has ever
// completed (fresh archive, `lastScan === null`), the empty state must
// say "Scan hasn't run yet." instead of the post-scan "Nothing to
// review." copy. Pre-fix both branches showed the same string and the
// user couldn't tell whether their archive was clean or unscanned.

let ctx: AppContext

test.beforeAll(async () => {
  // No extraFixtures → fresh archive → zero sessions → no scan ever
  // completed → `lastScanCompletedAt` stays null.
  ctx = await launchApp()
})

test.afterAll(async () => { await ctx?.cleanup() })

test('Empty Security page distinguishes never-scanned from scanned-clean', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  const title = window.locator('[data-testid="security-empty-title"]')
  await expect(title).toBeVisible()
  await expect(title).toHaveAttribute('data-scan-state', 'never')
  await expect(title).toHaveText(/Scan hasn't run yet\./)

  // P5: the trimmed info footnote is only shown when info-severity
  // categories exist, which they don't on a fresh archive — so we can't
  // assert it here. That copy is covered by snapshot/visual review.
})

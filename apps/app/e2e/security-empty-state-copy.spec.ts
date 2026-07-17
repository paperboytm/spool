import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// EmptyState copy split: the empty Security page must distinguish a
// completed scan that found nothing ("Nothing to review.",
// data-scan-state="clean") from a scan that never ran
// ("Scan hasn't run yet.", data-scan-state="never").
//
// The discriminator is `lastScanCompletedAt`: it is the global
// MAX(scan_completed_at) across all sessions, NOT derived from the
// (filtered, paginated) findings list. A scanned-clean session has a
// completion timestamp but zero findings; deriving "last scanned" from
// the findings list would see an empty list and mislabel "clean" as
// "never". This test guards that: launchApp's base fixtures contain no
// sensitive values, so they sync, scan, and complete with zero findings
// → scan_completed_at is set → the empty state reads "clean".
//
// Coverage note: the "never" branch (lastScanCompletedAt === null) is
// not exercised here. A genuine never-scanned state needs an archive
// where no session has ever completed a scan, which the base fixtures
// can't represent (they always scan on boot) and which is otherwise a
// brief, timing-dependent transient — not a stable e2e target. The
// branch is trivial renderer logic (`lastScan === null ? 'never' :
// 'clean'`) covered by reading the component.

let ctx: AppContext

test.beforeAll(async () => { ctx = await launchApp() })
test.afterAll(async () => { await ctx?.cleanup() })

test('Empty Security page reads "clean" after a scan completes with no findings', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  const title = window.locator('[data-testid="security-empty-title"]')
  await expect(title).toBeVisible()
  await expect(title).toHaveAttribute('data-scan-state', 'clean')
  await expect(title).toHaveText(/Nothing to review\./)
})

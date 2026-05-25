import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// Regression for the "Detector settings" button on the Security page's
// empty state. Pre-fix the button rendered without an `onClick`, so a
// clean archive (no findings) was a dead end — clicking did nothing.
// The button now plumbs through to App-level state that opens the
// Settings panel directly on the Security tab.

let ctx: AppContext

test.beforeAll(async () => {
  // No extraFixtures — fresh archive means zero findings, which is
  // exactly the empty-state condition under test.
  ctx = await launchApp()
})

test.afterAll(async () => { await ctx?.cleanup() })

test('Empty Security page exposes a working Detector settings shortcut', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // The empty state's shortcut should now be wired. Without onOpenSettings
  // wired all the way from App.tsx → SecurityPage → EmptyState, the button
  // wouldn't even render (the EmptyState gates it on the prop's presence).
  const button = window.locator('[data-testid="security-empty-detector-settings"]')
  await expect(button).toBeVisible()

  await button.click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  // The opened tab must be Security — verify by the presence of the
  // pane-specific rescan button (a unique testid only present inside
  // the Security pane).
  await expect(window.locator('[data-testid="settings-rescan-all"]')).toBeVisible({ timeout: 5_000 })
})

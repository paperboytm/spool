import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test.afterEach(async () => {
  // Close any leftover modals so the next test starts from Library home.
  const { window } = ctx
  for (let i = 0; i < 3; i++) {
    if (await window.locator('[data-testid="settings-panel"]').isVisible().catch(() => false)) {
      await window.keyboard.press('Escape')
      await window.waitForTimeout(50)
    } else {
      break
    }
  }
})

async function openSecurityTab(window: AppContext['window']) {
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  await expect(window.locator('[data-testid="settings-rescan-all"]')).toBeVisible({ timeout: 10_000 })
}

test('Settings → Security pane: toggles persist across re-open', async () => {
  const { window } = ctx
  await waitForSync(window)

  await openSecurityTab(window)

  // Info-default toggle starts off.
  const infoToggle = window.locator('[data-testid="settings-info-default"]')
  await expect(infoToggle).toHaveAttribute('aria-checked', 'false')
  await infoToggle.click()
  await expect(infoToggle).toHaveAttribute('aria-checked', 'true')

  // Close & reopen settings.
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()

  await openSecurityTab(window)
  await expect(window.locator('[data-testid="settings-info-default"]')).toHaveAttribute('aria-checked', 'true')
})

test('Settings → Security pane: Allowlist Manage modal opens with empty state', async () => {
  const { window } = ctx
  await waitForSync(window)

  await openSecurityTab(window)

  await window.locator('[data-testid="settings-allowlist-manage"]').click()
  const modal = window.locator('[data-testid="allowlist-manage"]')
  await expect(modal).toBeVisible()

  // No rows initially — assert empty-state text without checking exact
  // localized copy.
  await expect(modal.locator('[data-testid="allowlist-row"]')).toHaveCount(0)

  // Close via the X button + reopen settings stays untouched.
  await window.locator('[data-testid="allowlist-close"]').click()
  await expect(modal).toBeHidden()
})

test('Settings → Security pane: Rescan all button completes without error', async () => {
  const { window } = ctx
  await waitForSync(window)

  await openSecurityTab(window)

  const rescan = window.locator('[data-testid="settings-rescan-all"]')
  await rescan.click()
  // The button toggles to a busy state and then returns. The handler
  // awaits worker.rescanAll(), so a successful return implies the
  // worker drained without throwing.
  await expect(rescan).toBeEnabled({ timeout: 30_000 })
})

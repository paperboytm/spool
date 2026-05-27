import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail } from './helpers/share'

const SESSION_UUID = 'test-session-uuid-001'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openLabs(window: AppContext['window']) {
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window.locator('[aria-pressed]', { hasText: /Labs|实验|實驗|Labos|실험/ }).click()
  await expect(window.locator('[data-testid="labs-row-share"]')).toBeVisible()
}

test('Labs tab is reachable from Settings and shows the share row', async () => {
  const { window } = ctx
  await waitForSync(window)

  await openLabs(window)

  const row = window.locator('[data-testid="labs-row-share"]')
  await expect(row.locator('h4')).not.toBeEmpty()
  await expect(row.locator('p')).not.toBeEmpty()
  const feedback = row.locator('[data-testid="labs-feedback-share"]')
  await expect(feedback).toBeVisible()
  await expect(feedback).toHaveAttribute('href', /discord\.com|discord\.gg/)
  await expect(feedback).toHaveAttribute('target', '_blank')

  await window.keyboard.press('Escape')
})

test('toggle reflects resolved state, persists tri-state pref across reopen', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Start clean — no labs opinion. The e2e build sets VITE_FEATURE_SHARE=1
  // so the resolved value is ON via env; toggle should reflect that.
  await window.evaluate(() => localStorage.removeItem('spool.labs.share'))

  await openLabs(window)
  const toggle = window.locator('[data-testid="labs-toggle-share"]')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Click off → user choice "0" wins over env "1", resolved becomes false.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(await window.evaluate(() => localStorage.getItem('spool.labs.share'))).toBe('0')

  // Close & reopen — explicit "0" persists.
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
  await openLabs(window)
  await expect(window.locator('[data-testid="labs-toggle-share"]')).toHaveAttribute('aria-checked', 'false')

  // Click on → "1" persisted.
  await window.locator('[data-testid="labs-toggle-share"]').click()
  await expect(window.locator('[data-testid="labs-toggle-share"]')).toHaveAttribute('aria-checked', 'true')
  expect(await window.evaluate(() => localStorage.getItem('spool.labs.share'))).toBe('1')

  await window.keyboard.press('Escape')
})

test('disabling share while on /shares navigates back to Library with a toast', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Start with no labs opinion (env pins share on); navigate to Shares.
  await window.evaluate(() => localStorage.removeItem('spool.labs.share'))
  await window.locator('[data-testid="sidebar-shares"]').click()
  await expect(window.locator('[data-testid="shares-page"]')).toBeVisible()

  // Open Labs and turn share off.
  await openLabs(window)
  await window.locator('[data-testid="labs-toggle-share"]').click()
  await expect(window.locator('[data-testid="labs-toggle-share"]')).toHaveAttribute('aria-checked', 'false')

  // Close settings; Shares view should be gone and Shares sidebar entry too.
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="shares-page"]')).toBeHidden()
  await expect(window.locator('[data-testid="sidebar-shares"]')).toBeHidden()
  await expect(window.locator('text=/Share is off|分享|共有|공유|Teilen|Partage/i').first()).toBeVisible({ timeout: 3000 })

  // Restore for any later tests that share this app context.
  await window.evaluate(() => localStorage.removeItem('spool.labs.share'))
})

test('disabling share while in editor returns to the editor entry view (not Library)', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Reset labs pref, then enter the editor via session detail — the
  // returnView is captured as 'session'.
  await window.evaluate(() => localStorage.removeItem('spool.labs.share'))
  await openShareEditorFromSessionDetail(window, SESSION_UUID)

  // Share editor auto-collapses the sidebar; expand it so the settings
  // gear (which lives in the sidebar status bar) is reachable.
  const cmdB = process.platform === 'darwin' ? 'Meta+b' : 'Control+b'
  await window.keyboard.press(cmdB)

  await openLabs(window)
  await window.locator('[data-testid="labs-toggle-share"]').click()
  await window.keyboard.press('Escape')

  // We should land back on session detail, NOT on Library.
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeHidden()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await window.evaluate(() => localStorage.removeItem('spool.labs.share'))
})

test('Labs Security toggle gates the Security surfaces live (no restart)', async () => {
  const { window } = ctx
  await waitForSync(window)

  // launchApp seeds agents.json `securityEnabled: true`, so the feature
  // is opted in and the sidebar entry is present at rest.
  await expect(window.locator('[data-testid="sidebar-security"]')).toBeVisible()

  await openLabs(window)
  const toggle = window.locator('[data-testid="labs-toggle-security"]')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  // Turn OFF → every Security surface disappears immediately (the gate
  // is reactive; the main process also tears the worker down — asserted
  // indirectly by the UI, the worker lifecycle is unit-covered).
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="sidebar-security"]')).toBeHidden()

  // Turn back ON → the entry returns without a relaunch.
  await openLabs(window)
  await window.locator('[data-testid="labs-toggle-security"]').click()
  await expect(window.locator('[data-testid="labs-toggle-security"]')).toHaveAttribute('aria-checked', 'true')
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="sidebar-security"]')).toBeVisible()
})

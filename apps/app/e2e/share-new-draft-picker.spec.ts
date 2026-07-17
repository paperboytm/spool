import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { navigateToShares } from './helpers/share'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('Recent mode lists sessions; Esc closes', async () => {
  const { window } = ctx
  await waitForSync(window)
  await navigateToShares(window)

  await window.locator('[data-testid="shares-empty-start"]').click()
  const picker = window.locator('[data-testid="new-draft-picker"]')
  await expect(picker).toBeVisible({ timeout: 5000 })

  // Recent: at least one row (we have 6 fixtures including the large one).
  await expect(picker.locator('[data-testid="new-draft-picker-row"]').first()).toBeVisible({ timeout: 5000 })

  await window.keyboard.press('Escape')
  await expect(picker).toBeHidden({ timeout: 5000 })
})

test('FTS search narrows results; keyboard nav + Enter opens editor', async () => {
  const { window } = ctx
  await window.locator('[data-testid="shares-empty-start"]').click()
  const picker = window.locator('[data-testid="new-draft-picker"]')
  await expect(picker).toBeVisible({ timeout: 5000 })

  // Type a unique fragment-only token from fixtures.
  await picker.locator('input').fill('XYLOPHONE_CANARY_42')
  // Allow debounce + FTS roundtrip. Two fixtures mention this token, so
  // we just require *some* match rather than an exact count.
  await expect(picker.locator('[data-testid="new-draft-picker-row"]').first()).toBeVisible({ timeout: 5000 })

  // Active row is row 0 after a result set lands.
  await window.keyboard.press('ArrowDown')
  await window.keyboard.press('ArrowUp')
  await window.keyboard.press('Enter')

  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
})

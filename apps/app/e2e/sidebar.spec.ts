import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('sidebar is visible at startup with project rows', async () => {
  const { window } = ctx

  await waitForSync(window)

  const sidebar = window.locator('[data-testid="sidebar"]')
  await expect(sidebar).toBeVisible()

  const rows = window.locator('[data-testid="sidebar-project-row"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  expect(await rows.count()).toBeGreaterThanOrEqual(1)
})

test('clicking a sidebar project highlights the row', async () => {
  const { window } = ctx

  await waitForSync(window)

  const firstRow = window.locator('[data-testid="sidebar-project-row"]').first()
  await firstRow.click()
  await expect(firstRow).toHaveClass(/bg-warm-surface2/)
})

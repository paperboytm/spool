import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('clicking sidebar project shows ProjectView with session rows', async () => {
  const { window } = ctx
  await waitForSync(window)

  const firstRow = window.locator('[data-testid="sidebar-project-row"]').first()
  await firstRow.click()

  const projectView = window.locator('[data-testid="project-view"]')
  await expect(projectView).toBeVisible({ timeout: 5000 })

  const sessionRows = window.locator('[data-testid="session-row"]')
  await expect(sessionRows.first()).toBeVisible({ timeout: 5000 })
  expect(await sessionRows.count()).toBeGreaterThanOrEqual(1)
})

test('clicking sidebar wordmark returns to home', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(window.locator('[data-testid="project-view"]')).toBeVisible()

  await window.locator('[data-testid="sidebar-library"]').click()
  await expect(window.locator('[data-testid="project-view"]')).toBeHidden()
  await expect(window.locator('[data-testid="library-landing"]')).toBeVisible()
})

test('clicking session row opens session detail', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()

  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
})

test('changing sort order reloads sessions', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })

  const recentFirst = await firstRow.getAttribute('data-session-uuid')
  expect(recentFirst).not.toBeNull()

  await window.locator('[data-testid="project-sort"]').click()
  await window.getByRole('menuitem', { name: 'Oldest' }).click()

  await expect(firstRow).not.toHaveAttribute('data-session-uuid', recentFirst!, { timeout: 5000 })
})

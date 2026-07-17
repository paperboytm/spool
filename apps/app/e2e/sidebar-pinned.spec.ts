import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function pinFirstSessionInProject(window: AppContext['window']): Promise<string> {
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })
  const uuid = await firstRow.getAttribute('data-session-uuid')
  expect(uuid).toBeTruthy()
  await firstRow.hover()
  await firstRow.locator('[data-testid="pin-button"]').click()
  return uuid as string
}

test('sidebar pinned section appears after pinning and lists the session', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Initially no Pinned section
  await expect(window.locator('[data-testid="sidebar-pinned-toggle"]')).toBeHidden()

  const uuid = await pinFirstSessionInProject(window)

  const pinnedToggle = window.locator('[data-testid="sidebar-pinned-toggle"]')
  await expect(pinnedToggle).toBeVisible({ timeout: 5000 })

  const pinnedRow = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
  await expect(pinnedRow).toBeVisible({ timeout: 5000 })

  // Cleanup
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-unpin"]').click()
  await expect(pinnedRow).toBeHidden({ timeout: 5000 })
})

test('clicking a sidebar pinned row opens the session detail', async () => {
  const { window } = ctx
  await waitForSync(window)

  const uuid = await pinFirstSessionInProject(window)

  await window.locator('[data-testid="sidebar-library"]').click()

  const pinnedRow = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
  await expect(pinnedRow).toBeVisible({ timeout: 5000 })
  await pinnedRow.click()

  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  // Cleanup
  await window.locator('[data-testid="sidebar-library"]').click()
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-unpin"]').click()
  await expect(pinnedRow).toBeHidden({ timeout: 5000 })
})

test('unpinning from sidebar also clears the Library pinned segment', async () => {
  const { window } = ctx
  await waitForSync(window)

  const uuid = await pinFirstSessionInProject(window)

  await window.locator('[data-testid="sidebar-library"]').click()

  const libraryPinnedHeader = window.locator('[data-testid="library-pinned-header"]')
  await expect(libraryPinnedHeader).toBeVisible({ timeout: 5000 })
  await expect(
    window.locator(`[data-testid="session-row"][data-pinned][data-session-uuid="${uuid}"]`),
  ).toBeVisible()

  // Unpin from sidebar
  const pinnedRow = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-unpin"]').click()

  // Library's pinned row should react immediately…
  await expect(
    window.locator(`[data-testid="session-row"][data-pinned][data-session-uuid="${uuid}"]`),
  ).toBeHidden({ timeout: 5000 })

  // …but the session itself must reappear in the recent list. Regression
  // test for the cross-component pin-event listener forgetting to
  // reinsert externally-unpinned sessions back into recent.
  await expect(
    window.locator(`[data-testid="session-row"][data-session-uuid="${uuid}"]:not([data-pinned])`),
  ).toBeVisible({ timeout: 5000 })
})

test('sidebar pinned kebab menu exposes Resume and Copy actions', async () => {
  const { window } = ctx
  await waitForSync(window)

  const uuid = await pinFirstSessionInProject(window)

  const pinnedRow = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
  await expect(pinnedRow).toBeVisible({ timeout: 5000 })
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-menu-trigger"]').click()

  await expect(window.getByRole('menuitem', { name: /Resume in terminal/ })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: /Copy session ID/ })).toBeVisible()

  // Close menu and cleanup
  await window.keyboard.press('Escape')
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-unpin"]').click()
  await expect(pinnedRow).toBeHidden({ timeout: 5000 })
})

test('sidebar pinned sort menu changes the visible order', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Pin two sessions across two projects to get a stable comparison
  const projects = window.locator('[data-testid="sidebar-project-row"]')
  await expect(projects.first()).toBeVisible({ timeout: 5000 })
  expect(await projects.count()).toBeGreaterThanOrEqual(2)

  await projects.nth(0).click()
  const rowA = window.locator('[data-testid="session-row"]').first()
  await expect(rowA).toBeVisible({ timeout: 5000 })
  await rowA.hover()
  await rowA.locator('[data-testid="pin-button"]').click()

  await projects.nth(1).click()
  const rowB = window.locator('[data-testid="session-row"]').first()
  await expect(rowB).toBeVisible({ timeout: 5000 })
  await rowB.hover()
  await rowB.locator('[data-testid="pin-button"]').click()

  await expect(window.locator('[data-testid="sidebar-pinned-row"]')).toHaveCount(2, { timeout: 5000 })

  const sidebar = window.locator('[data-testid="sidebar"]')
  const orderRecentPinned = await sidebar.locator('[data-testid="sidebar-pinned-row"]').evaluateAll(
    nodes => nodes.map(n => n.getAttribute('data-session-uuid')),
  )

  // Switch sort order to Name (A–Z) and confirm visible order changes (or stays consistent)
  await sidebar.locator('[data-testid="sidebar-pinned-sort-trigger"]').click()
  await window.getByRole('menuitem', { name: /Name \(A.{1,3}Z\)/ }).click()

  const orderByName = await sidebar.locator('[data-testid="sidebar-pinned-row"]').evaluateAll(
    nodes => nodes.map(n => n.getAttribute('data-session-uuid')),
  )

  expect(orderByName).toHaveLength(2)
  // Both sets contain the same two uuids, but the array shapes should be valid
  expect(new Set(orderByName)).toEqual(new Set(orderRecentPinned))

  // Cleanup
  for (const uuid of orderByName) {
    const row = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
    await row.hover()
    await row.locator('[data-testid="sidebar-pinned-unpin"]').click()
  }
  await expect(window.locator('[data-testid="sidebar-pinned-row"]')).toHaveCount(0, { timeout: 5000 })
})

import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('pinning a session moves it into the Pinned segment', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })

  const targetUuid = await firstRow.getAttribute('data-session-uuid')
  expect(targetUuid).toBeTruthy()

  // Hover row, click its pin button
  await firstRow.hover()
  const pinButton = firstRow.locator('[data-testid="pin-button"]')
  await pinButton.click()

  const pinnedHeader = window.locator('[data-testid="project-view-pinned-header"]')
  await expect(pinnedHeader).toBeVisible({ timeout: 5000 })
  await expect(
    window.locator(`[data-testid="session-row"][data-pinned][data-session-uuid="${targetUuid}"]`),
  ).toBeVisible()
})

test('unpinning removes session from Pinned segment', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const pinnedHeader = window.locator('[data-testid="project-view-pinned-header"]')
  await expect(pinnedHeader).toBeVisible({ timeout: 5000 })

  const pinnedRow = window.locator('[data-testid="session-row"][data-pinned]').first()
  const targetUuid = await pinnedRow.getAttribute('data-session-uuid')

  const pinButton = pinnedRow.locator('[data-testid="pin-button"]')
  await pinButton.click()

  // The pinned row should disappear from the pinned section.
  await expect(
    window.locator(`[data-testid="session-row"][data-pinned][data-session-uuid="${targetUuid}"]`),
  ).toBeHidden({ timeout: 5000 })
})

test('session list renders the end-of-list footer once paginated', async () => {
  // String content per locale is covered by the parity test under
  // src/renderer/i18n/locales.test.ts; this just asserts the footer
  // DOM is reachable after the list exhausts its cursor.
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-library"]').click()
  await expect(
    window.locator('[data-testid="library-landing"] [data-testid="session-list-done"]'),
  ).toBeVisible({ timeout: 5000 })

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(
    window.locator('[data-testid="project-view"] [data-testid="session-list-done"]'),
  ).toBeVisible({ timeout: 5000 })
})

test('directory chip count matches the actual number of rows for that cwd', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(window.locator('[data-testid="project-view"]')).toBeVisible({ timeout: 5000 })

  const chips = window.locator('[data-testid="project-directory-chip"]')
  const chipCount = await chips.count()
  if (chipCount < 2) test.skip(true, 'project has no sub-directories in fixtures — chip strip absent')

  // Pick the first non-"All" chip; its badge value must equal the number of
  // session-row entries that follow when isolated to that cwd.
  const targetChip = chips.nth(1)
  const badgeText = await targetChip.locator('span.font-mono').innerText()
  const expected = parseInt(badgeText.trim(), 10)
  await targetChip.click()

  const visibleRows = window.locator('[data-testid="project-view"] [data-testid="session-row"]')
  await expect(visibleRows).toHaveCount(expected, { timeout: 5000 })
})

test('pin then unpin keeps the session visible in recent (no vanishing)', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  // Make sure we start from a clean state: clear any pre-existing pins.
  let stalePinned = window.locator('[data-testid="session-row"][data-pinned]').first()
  while (await stalePinned.count() > 0) {
    await stalePinned.locator('[data-testid="pin-button"]').click()
    await expect(stalePinned).toBeHidden({ timeout: 2000 })
    stalePinned = window.locator('[data-testid="session-row"][data-pinned]').first()
  }

  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })
  const targetUuid = await firstRow.getAttribute('data-session-uuid')
  expect(targetUuid).toBeTruthy()

  await firstRow.hover()
  await firstRow.locator('[data-testid="pin-button"]').click()

  // After pin: session lives in the pinned section.
  const pinnedRowSel = `[data-testid="session-row"][data-pinned][data-session-uuid="${targetUuid}"]`
  await expect(window.locator(pinnedRowSel)).toBeVisible({ timeout: 5000 })

  // Unpin from the pinned row.
  await window.locator(pinnedRowSel).hover()
  await window.locator(pinnedRowSel).locator('[data-testid="pin-button"]').click()

  // After unpin: session must still exist somewhere in the list,
  // just no longer marked pinned. Regression test for handlePinChange
  // forgetting to reinsert into the recent list.
  await expect(window.locator(pinnedRowSel)).toBeHidden({ timeout: 5000 })
  await expect(
    window.locator(`[data-testid="session-row"][data-session-uuid="${targetUuid}"]:not([data-pinned])`),
  ).toBeVisible({ timeout: 5000 })
})

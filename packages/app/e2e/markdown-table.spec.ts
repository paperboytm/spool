import { test, expect, type Locator } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail } from './helpers/share'

let ctx: AppContext

const TABLE_SESSION_UUID = 'table-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

// Wide table must keep natural column widths: content overflows the
// wrapper (which scrolls), while the wrapper stays inside its column.
async function expectScrollContained(wide: Locator) {
  await expect(wide.locator('td').first()).toHaveCSS('max-width', '360px')
  const wrapper = wide.locator('..')
  await expect(wrapper).toHaveCSS('overflow-x', 'auto')
  const metrics = await wrapper.evaluate((el) => ({
    scrolls: el.scrollWidth > el.clientWidth + 8,
    contained:
      el.getBoundingClientRect().width <= el.parentElement!.getBoundingClientRect().width + 1,
  }))
  expect(metrics).toEqual({ scrolls: true, contained: true })
}

// First fixture table's columns are `:--- | :---: | ---:` — left, center, right.
async function expectGfmAlignment(table: Locator) {
  await expect(table.locator('th').nth(0)).toHaveCSS('text-align', 'left')
  await expect(table.locator('th').nth(1)).toHaveCSS('text-align', 'center')
  await expect(table.locator('th').nth(2)).toHaveCSS('text-align', 'right')
  await expect(table.locator('tbody td').nth(1)).toHaveCSS('text-align', 'center')
  await expect(table.locator('tbody td').nth(2)).toHaveCSS('text-align', 'right')
}

async function openTableSession() {
  const { window } = ctx
  await waitForSync(window)
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window
    .locator(`[data-testid="session-row"][data-session-uuid="${TABLE_SESSION_UUID}"]`)
    .click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
}

test('session detail renders GFM table with column alignment and cell chrome', async () => {
  const { window } = ctx
  await openTableSession()

  const table = window.locator('[data-testid="session-detail"] table').first()
  await expect(table).toBeVisible()
  await expectGfmAlignment(table)

  await expect(table.locator('th').first()).toHaveCSS('border-bottom-width', '1px')
  await expect(table.locator('th').first()).toHaveCSS('padding-top', '4px')
})

test('session detail: wide table keeps natural column widths and scrolls horizontally', async () => {
  const { window } = ctx
  await openTableSession()

  // Second fixture table has 9 columns + long tokens — wider than the pane.
  const wide = window.locator('[data-testid="session-detail"] table').nth(1)
  await expect(wide).toBeVisible()
  await expectScrollContained(wide)
})

test('share preview renders GFM table with alignment and explicit cell padding', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, TABLE_SESSION_UUID)

  const table = window.locator('[data-testid="share-preview-render"] table').first()
  await expect(table).toBeVisible()
  await expectGfmAlignment(table)

  // Tailwind preflight zeroes td/th padding in the desktop preview; the
  // share-kit Body must pin its own so preview matches the published page.
  await expect(table.locator('td').first()).toHaveCSS('padding-top', '4px')
  await expect(table.locator('td').first()).toHaveCSS('padding-left', '8px')
  await expect(table.locator('th').first()).toHaveCSS('font-weight', '600')
})

test('share preview: wide table keeps natural column widths inside its scroll wrapper', async () => {
  const { window } = ctx
  const wide = window.locator('[data-testid="share-preview-render"] table').nth(1)
  await expect(wide).toBeVisible()
  await expectScrollContained(wide)
})

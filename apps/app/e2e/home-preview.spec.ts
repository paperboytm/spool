import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
  await waitForSync(ctx.window)
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openOverlayAndType(ctx: AppContext, query: string) {
  const overlay = ctx.window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await ctx.window.locator('[data-testid="sidebar-search"]').first().click()
  }
  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(query)
}

async function closeOverlay(ctx: AppContext) {
  await ctx.window.keyboard.press('Escape')
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
}

test('overlay shows live result with highlighted match for canary keyword', async () => {
  await openOverlayAndType(ctx, 'XYLOPHONE_CANARY_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await expect(firstResult.locator('strong')).toContainText('XYLOPHONE_CANARY_42')

  await closeOverlay(ctx)
})

test('overlay live results are case-insensitive', async () => {
  await openOverlayAndType(ctx, 'xylophone_canary_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await expect(firstResult.locator('strong').first()).toContainText(/xylophone_canary_42/i)

  await closeOverlay(ctx)
})

test('clicking an overlay result jumps to message with flash highlight', async () => {
  await openOverlayAndType(ctx, 'XYLOPHONE_CANARY_42')

  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 5000 })
  await firstResult.click()

  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
  const target = ctx.window.locator('[data-testid="target-message"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await expect(target).toHaveAttribute('data-highlighted', '1')
})

test('overlay footer shows keyboard hints', async () => {
  const overlay = ctx.window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await ctx.window.locator('[data-testid="sidebar-search"]').first().click()
  }
  await expect(overlay).toBeVisible({ timeout: 3000 })

  // Recents state: navigate + open + close hints
  await expect(overlay.getByText('navigate')).toBeVisible()
  await expect(overlay.getByText('open', { exact: true })).toBeVisible()
  await expect(overlay.getByText('close')).toBeVisible()

  // Typing a query that yields results adds the "view all" hint
  await ctx.window.locator('[data-testid="search-overlay-input"]').fill('XYLOPHONE_CANARY_42')
  await expect(overlay.locator('[role="option"]').first()).toBeVisible({ timeout: 5000 })
  await expect(overlay.getByText('view all')).toBeVisible()

  await closeOverlay(ctx)
})

test('arrow-down navigation keeps the active item in view at the bottom', async () => {
  const overlay = ctx.window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await ctx.window.locator('[data-testid="sidebar-search"]').first().click()
  }
  await expect(overlay).toBeVisible({ timeout: 3000 })

  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeFocused()

  // Recents list — press Down to the last option, then verify it is in viewport
  // (i.e. the scroll container scrolled to follow the active item).
  const options = overlay.locator('[role="option"]')
  // Recents are now virtualized — wait for at least one option to actually
  // mount before counting, otherwise we race the initial Virtuoso measure.
  await options.first().waitFor({ state: 'visible', timeout: 3000 })
  const count = await options.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count + 5; i++) {
    await ctx.window.keyboard.press('ArrowDown')
  }

  const last = options.nth(count - 1)
  await expect(last).toHaveAttribute('aria-selected', 'true')
  await expect(last).toBeInViewport()

  // ArrowUp back to the top should also keep the active item in view.
  for (let i = 0; i < count + 5; i++) {
    await ctx.window.keyboard.press('ArrowUp')
  }
  const first = options.first()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await expect(first).toBeInViewport()

  await closeOverlay(ctx)
})

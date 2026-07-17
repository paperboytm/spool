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

async function openOverlay(): Promise<void> {
  await ctx.window.locator('[data-testid="sidebar-search"]').first().click()
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeVisible({ timeout: 3000 })
}

async function closeOverlay(): Promise<void> {
  await ctx.window.keyboard.press('Escape')
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
}

async function navigateToLibrary(): Promise<void> {
  await ctx.window.locator('[data-testid="sidebar-library"]').click()
  await expect(ctx.window.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 3000 })
}

async function navigateToProject(): Promise<void> {
  await ctx.window.locator('[data-testid="sidebar-project-row"]').first().click()
}

async function openOptions(): Promise<void> {
  const row = ctx.window.locator('[data-testid="search-overlay-options-row"]')
  if (!(await row.isVisible().catch(() => false))) {
    await ctx.window.locator('[data-testid="search-overlay-options-toggle"]').click()
  }
  await expect(row).toBeVisible({ timeout: 2000 })
}

test('opened from Library: filter row hidden by default; toggle reveals Any project chip', async () => {
  await navigateToLibrary()
  await openOverlay()
  await expect(ctx.window.locator('[data-testid="search-overlay-options-row"]')).toHaveCount(0)
  await openOptions()
  const chip = ctx.window.locator('[data-testid="search-overlay-scope-trigger"]')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/Any project/i)
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-tabhint"]')).toHaveCount(0)
  await closeOverlay()
})

test('opened from project view: filter row auto-opens with contextual scope', async () => {
  await navigateToProject()
  await openOverlay()
  const chip = ctx.window.locator('[data-testid="search-overlay-scope-trigger"]')
  await expect(chip).toBeVisible()
  await expect(chip).not.toContainText(/Any project/i)
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-tabhint"]')).toBeVisible()
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-clear"]')).toBeVisible()
  await closeOverlay()
})

test('Tab toggles between contextual project and Any', async () => {
  await navigateToProject()
  await openOverlay()
  const chip = ctx.window.locator('[data-testid="search-overlay-scope-trigger"]')
  const contextualName = (await chip.textContent())?.trim() ?? ''
  expect(contextualName).not.toMatch(/Any project/i)

  await ctx.window.locator('[data-testid="search-overlay-input"]').press('Tab')
  await expect(chip).toContainText(/Any project/i)

  await ctx.window.locator('[data-testid="search-overlay-input"]').press('Tab')
  await expect(chip).not.toContainText(/Any project/i)
  await closeOverlay()
})

test('scope popover lists projects and can be selected', async () => {
  await navigateToLibrary()
  await openOverlay()
  await openOptions()
  await ctx.window.locator('[data-testid="search-overlay-scope-trigger"]').click()
  const popover = ctx.window.locator('[data-testid="search-overlay-scope-popover"]')
  await expect(popover).toBeVisible({ timeout: 2000 })
  const projectOption = popover
    .locator('[data-testid="search-overlay-scope-option"][data-identity-key]:not([data-identity-key=""])')
    .first()
  await expect(projectOption).toBeVisible()
  await projectOption.click()
  await expect(popover).toBeHidden({ timeout: 2000 })
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-trigger"]')).not.toContainText(/Any project/i)
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-clear"]')).toBeVisible()
  await closeOverlay()
})

test('after popover close, focus returns to the search input', async () => {
  // Regression guard: if focus leaks out of the input after the popover
  // closes, Tab triggers browser focus navigation instead of the scope
  // toggle, and ↑↓ stop driving the result list.
  await navigateToLibrary()
  await openOverlay()
  await openOptions()
  const popover = ctx.window.locator('[data-testid="search-overlay-scope-popover"]')

  // Select path.
  await ctx.window.locator('[data-testid="search-overlay-scope-trigger"]').click()
  await expect(popover).toBeVisible({ timeout: 2000 })
  await popover
    .locator('[data-testid="search-overlay-scope-option"][data-identity-key]:not([data-identity-key=""])')
    .first().click()
  await expect(popover).toBeHidden({ timeout: 2000 })
  let focused = await ctx.window.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null,
  )
  expect(focused).toBe('search-overlay-input')

  // Escape path.
  await ctx.window.locator('[data-testid="search-overlay-scope-trigger"]').click()
  await expect(popover).toBeVisible({ timeout: 2000 })
  await ctx.window.keyboard.press('Escape')
  await expect(popover).toBeHidden({ timeout: 2000 })
  focused = await ctx.window.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? null,
  )
  expect(focused).toBe('search-overlay-input')

  await closeOverlay()
})

test('cmdk recents are bucketed by date header', async () => {
  await navigateToLibrary()
  await openOverlay()
  const header = ctx.window.locator('[data-testid="search-overlay-bucket-header"]').first()
  await expect(header).toBeVisible({ timeout: 3000 })
  await expect(header).toContainText(/Today|Yesterday|Earlier|Older/i)
  await closeOverlay()
})

test('options toggle: clicking with scope set keeps scope active even when row hides', async () => {
  // Edge case: user collapses the options row while a project scope is
  // active. The scope must remain applied (recents stay scoped) and the
  // toggle button must signal that hidden state by switching to accent.
  await navigateToProject()
  await openOverlay()
  await expect(ctx.window.locator('[data-testid="search-overlay-options-row"]')).toBeVisible()
  const scopeLabelBefore = await ctx.window
    .locator('[data-testid="search-overlay-scope-trigger"]')
    .textContent()
  await ctx.window.locator('[data-testid="search-overlay-options-toggle"]').click()
  await expect(ctx.window.locator('[data-testid="search-overlay-options-row"]')).toHaveCount(0)
  // Scope state survives even though the chip is hidden; toggling the
  // options row back open should reveal the same label.
  await ctx.window.locator('[data-testid="search-overlay-options-toggle"]').click()
  await expect(ctx.window.locator('[data-testid="search-overlay-options-row"]')).toBeVisible()
  await expect(ctx.window.locator('[data-testid="search-overlay-scope-trigger"]'))
    .toHaveText(scopeLabelBefore ?? '')
  await closeOverlay()
})

test('Shift+Enter from FTS results commits to results page', async () => {
  await navigateToLibrary()
  await openOverlay()
  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await input.fill('XYLOPHONE_CANARY_42')
  const firstResult = ctx.window.locator('[data-testid="search-overlay"] [role="option"]').first()
  await expect(firstResult).toBeVisible({ timeout: 3000 })
  await input.press('Shift+Enter')
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
  await expect(ctx.window.locator('[data-testid="results-scope-chip"]')).toBeVisible({ timeout: 3000 })
})

test('clicking the results-total badge commits to results page', async () => {
  await navigateToLibrary()
  await openOverlay()
  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await input.fill('XYLOPHONE_CANARY_42')
  const badge = ctx.window.locator('[data-testid="search-overlay-results-total"]')
  await expect(badge).toBeVisible({ timeout: 3000 })
  await badge.click()
  await expect(ctx.window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
  await expect(ctx.window.locator('[data-testid="results-scope-chip"]')).toBeVisible({ timeout: 3000 })
})

test('results-total badge is hidden in recents mode and appears in search mode', async () => {
  await navigateToLibrary()
  await openOverlay()
  // Empty query → recents view → no count badge (deliberate: the count was
  // visual noise that distracted from the list).
  await expect(ctx.window.locator('[data-testid="search-overlay-results-total"]')).toHaveCount(0)
  const input = ctx.window.locator('[data-testid="search-overlay-input"]')
  await input.fill('XYLOPHONE_CANARY_42')
  await expect(ctx.window.locator('[data-testid="search-overlay-results-total"]')).toBeVisible({ timeout: 3000 })
  // Clearing the query reverts to recents — badge disappears again.
  await input.fill('')
  await expect(ctx.window.locator('[data-testid="search-overlay-results-total"]')).toHaveCount(0)
  await closeOverlay()
})

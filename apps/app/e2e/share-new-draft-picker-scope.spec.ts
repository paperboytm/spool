import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openPicker(): Promise<void> {
  await ctx.window.locator('[data-testid="sidebar-shares"]').click()
  await expect(
    ctx.window.locator('[data-testid="shares-empty-start"], [data-testid="shares-draft-row"]').first(),
  ).toBeVisible({ timeout: 5000 })
  const empty = ctx.window.locator('[data-testid="shares-empty-start"]')
  const plus = ctx.window.locator('[data-testid="shares-new-draft"]')
  if (await empty.isVisible().catch(() => false)) {
    await empty.click()
  } else {
    await plus.click()
  }
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeVisible({ timeout: 5000 })
}

async function closePicker(): Promise<void> {
  const picker = ctx.window.locator('[data-testid="new-draft-picker"]')
  if (await picker.isVisible().catch(() => false)) {
    await ctx.window.keyboard.press('Escape')
    await expect(picker).toBeHidden({ timeout: 5000 })
  }
}

test('scope chip defaults to Any project', async () => {
  await openPicker()
  const chip = ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]')
  await expect(chip).toBeVisible()
  await expect(chip).toContainText(/Any project/i)
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-clear"]')).toHaveCount(0)
  await closePicker()
})

test('row breadcrumb shows project label in default scope', async () => {
  await openPicker()
  const firstRow = ctx.window.locator('[data-testid="new-draft-picker-row"]').first()
  await expect(firstRow).toBeVisible()
  await expect(firstRow).toContainText('·')
  await closePicker()
})

test('recents are bucketed by date header', async () => {
  await openPicker()
  // At least one bucket label (Today / Yesterday / Earlier this week / ...)
  // renders inside the virtualized recents list.
  const header = ctx.window.locator('[data-testid="new-draft-picker-bucket-header"]').first()
  await expect(header).toBeVisible({ timeout: 3000 })
  await expect(header).toContainText(/Today|Yesterday|Earlier|Older/i)
  await closePicker()
})

test('options toggle hides and reveals the scope row', async () => {
  await openPicker()
  const row = ctx.window.locator('[data-testid="new-draft-picker-options-row"]')
  // Default-open for NewDraftPicker (scoping is the core feature).
  await expect(row).toBeVisible()
  await ctx.window.locator('[data-testid="new-draft-picker-options-toggle"]').click()
  await expect(row).toHaveCount(0)
  await ctx.window.locator('[data-testid="new-draft-picker-options-toggle"]').click()
  await expect(row).toBeVisible()
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]')).toBeVisible()
  await closePicker()
})

test('chip opens popover; Escape closes popover before modal', async () => {
  await openPicker()
  const chip = ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]')
  await chip.click()
  const popover = ctx.window.locator('[data-testid="new-draft-picker-scope-popover"]')
  await expect(popover).toBeVisible({ timeout: 2000 })
  await ctx.window.keyboard.press('Escape')
  await expect(popover).toBeHidden({ timeout: 2000 })
  // Modal must still be open — Escape was consumed by the popover layer.
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeVisible()
  await closePicker()
})

test('outside click closes popover but not the modal', async () => {
  await openPicker()
  await ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]').click()
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-popover"]')).toBeVisible()
  // Click somewhere inside the picker but outside the popover (the search
  // input strip is a safe target — clicking it doesn't fire a session pick).
  await ctx.window.locator('[data-testid="new-draft-picker"] input[type="text"]').first().click()
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-popover"]')).toBeHidden({ timeout: 2000 })
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeVisible()
  await closePicker()
})

test('selecting a project scopes the picker and hides row breadcrumbs', async () => {
  await openPicker()
  await ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]').click()
  const popover = ctx.window.locator('[data-testid="new-draft-picker-scope-popover"]')
  await expect(popover).toBeVisible()
  // First non-"Any project" option corresponds to a real project group.
  const projectOption = popover.locator('[data-testid="new-draft-picker-scope-option"][data-identity-key]:not([data-identity-key=""])').first()
  await expect(projectOption).toBeVisible()
  const projectName = (await projectOption.locator('span').first().textContent())?.trim() ?? ''
  await projectOption.click()
  await expect(popover).toBeHidden({ timeout: 2000 })

  // Chip now reflects the scoped project and a clear button appears.
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]')).toContainText(projectName)
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-clear"]')).toBeVisible()

  // Row breadcrumb suffix is suppressed under scope (project name would be
  // redundant on every row).
  const firstRow = ctx.window.locator('[data-testid="new-draft-picker-row"]').first()
  await expect(firstRow).toBeVisible()
  await expect(firstRow).not.toContainText('·')

  // Clear scope; chip returns to default.
  await ctx.window.locator('[data-testid="new-draft-picker-scope-clear"]').click()
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]')).toContainText(/Any project/i)
  await expect(ctx.window.locator('[data-testid="new-draft-picker-scope-clear"]')).toHaveCount(0)
  await closePicker()
})

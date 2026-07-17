import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  navigateToShares,
  openShareEditorFromSessionDetail,
  shareFromSessionRowMenu,
} from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function closeEditorIfOpen() {
  const editor = ctx.window.locator('[data-testid="share-editor-page"]')
  if (await editor.isVisible().catch(() => false)) {
    await ctx.window.getByRole('button', { name: 'Back' }).first().click()
    await expect(editor).toBeHidden({ timeout: 5000 })
  }
}

test('entry point: SessionDetail header BookText button opens editor', async () => {
  await waitForSync(ctx.window)
  await openShareEditorFromSessionDetail(ctx.window, SESSION_UUID)
  await closeEditorIfOpen()
})

test('entry point: SessionRow ⋯ menu in project view opens editor', async () => {
  await shareFromSessionRowMenu(ctx.window, SESSION_UUID)
  await closeEditorIfOpen()
})

test('entry point: Sidebar Shares row navigates to Shares', async () => {
  await navigateToShares(ctx.window)
  await expect(ctx.window.locator('[data-testid="shares-page"]')).toBeVisible({ timeout: 5000 })
})

test('entry point: NewDraftPicker opens (via empty-state CTA or + button)', async () => {
  // After the previous header / menu tests we now have at least one
  // persisted draft, so the empty state is hidden and the `+` button is
  // the live entry point. Tolerate either surface.
  const empty = ctx.window.locator('[data-testid="shares-empty-start"]')
  const plus = ctx.window.locator('[data-testid="shares-new-draft"]')
  if (await empty.isVisible().catch(() => false)) {
    await empty.click()
  } else {
    await expect(plus).toBeVisible({ timeout: 5000 })
    await plus.click()
  }
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeVisible({ timeout: 5000 })
  await ctx.window.keyboard.press('Escape')
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeHidden({ timeout: 5000 })
})

test('entry point: LibraryLanding ⋯ menu Share opens editor', async () => {
  await ctx.window.locator('[data-testid="sidebar-library"]').click()
  await expect(ctx.window.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 5000 })
  const row = ctx.window
    .locator(`[data-testid="session-row"][data-session-uuid="${SESSION_UUID}"]`)
    .first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.hover()
  await row.getByLabel('More actions').click()
  await ctx.window.getByRole('menuitem', { name: 'Edit share draft' }).click()
  await expect(ctx.window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
  await closeEditorIfOpen()
})

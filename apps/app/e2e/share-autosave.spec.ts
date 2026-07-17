import { test, expect } from '@playwright/test'
import { launchApp, restartApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail, navigateToShares } from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('opts mutations + title rename survive a full app restart', async () => {
  await waitForSync(ctx.window)
  await openShareEditorFromSessionDetail(ctx.window, SESSION_UUID)

  // Change a few opts.
  await ctx.window.locator('[data-testid="share-editor-template-forum"]').click()
  await ctx.window.locator('[data-testid="share-editor-paper-ink"]').click()
  await ctx.window.locator('[data-testid="share-editor-colorway-sage"]').click()

  // Rename via the modal.
  await ctx.window.locator('[data-testid="share-editor-more"]').click()
  await ctx.window.getByRole('menuitem', { name: 'Rename draft' }).click()
  const input = ctx.window.locator('[data-testid="rename-draft-input"]')
  await expect(input).toBeVisible()
  await input.fill('Autosave checkpoint')
  await ctx.window.locator('[data-testid="rename-draft-save"]').click()
  await expect(ctx.window.locator('[data-testid="share-editor-title"]')).toHaveText('Autosave checkpoint')

  // Autosave is debounced at 400ms — give it a safe margin before
  // tearing down the renderer.
  await ctx.window.waitForTimeout(800)

  ctx = await restartApp(ctx)
  await waitForSync(ctx.window)

  await navigateToShares(ctx.window)
  // Open the persisted draft from the grid.
  const draftCard = ctx.window
    .locator('[data-testid="shares-draft-row"][aria-label="Open Autosave checkpoint"]')
    .first()
  await expect(draftCard).toBeVisible({ timeout: 5000 })
  await draftCard.click()

  await expect(ctx.window.locator('[data-testid="share-editor-title"]')).toHaveText('Autosave checkpoint')
  const preview = ctx.window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toHaveAttribute('data-template', 'forum')
  await expect(preview).toHaveAttribute('data-paper', 'ink')
  await expect(preview).toHaveAttribute('data-colorway', 'sage')

  // Leave a clean state for the tests that follow.
  await ctx.window.getByRole('button', { name: 'Back' }).first().click()
})

test('rename modal updates the live preview render (not just the topbar)', async () => {
  // Regression: previously the rename modal updated the topbar's title
  // state but the preview pane received the un-merged `conversation`
  // object, so the rendered template kept the original conversation
  // title until next mount.
  await openShareEditorFromSessionDetail(ctx.window, SESSION_UUID)

  await ctx.window.locator('[data-testid="share-editor-more"]').click()
  await ctx.window.getByRole('menuitem', { name: 'Rename draft' }).click()
  const input = ctx.window.locator('[data-testid="rename-draft-input"]')
  await expect(input).toBeVisible()
  await input.fill('Live preview rename')
  await ctx.window.locator('[data-testid="rename-draft-save"]').click()

  // Topbar reflects immediately.
  await expect(ctx.window.locator('[data-testid="share-editor-title"]')).toHaveText('Live preview rename')

  // The rendered template's title heading must also show the new title.
  const preview = ctx.window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toContainText('Live preview rename')

  await ctx.window.getByRole('button', { name: 'Back' }).first().click()
})

test('unmount flush — opts change + immediate Back persists without waiting for debounce', async () => {
  // Regression: a user who changes an opt and clicks Back inside the
  // 400ms debounce window would lose that change. The unmount-time
  // flush should pick up the pending payload and write it.
  await openShareEditorFromSessionDetail(ctx.window, SESSION_UUID)

  // Reset state to a known baseline by clicking through a couple of
  // opts and waiting for autosave to settle.
  await ctx.window.locator('[data-testid="share-editor-template-chat"]').click()
  await ctx.window.locator('[data-testid="share-editor-paper-snow"]').click()
  await ctx.window.locator('[data-testid="share-editor-colorway-amber"]').click()
  await ctx.window.waitForTimeout(600)

  // Now make a change and *immediately* go Back — well under 400ms.
  await ctx.window.locator('[data-testid="share-editor-template-timeline"]').click()
  await ctx.window.getByRole('button', { name: 'Back' }).first().click()

  // Navigate to Shares and reopen the same draft. The change should
  // have been flushed on unmount.
  await navigateToShares(ctx.window)
  const card = ctx.window.locator('[data-testid="shares-draft-row"]').first()
  await expect(card).toBeVisible({ timeout: 5000 })
  await card.click()

  const preview = ctx.window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toHaveAttribute('data-template', 'timeline', { timeout: 5000 })

  await ctx.window.getByRole('button', { name: 'Back' }).first().click()
})

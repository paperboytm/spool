import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { navigateToShares, openShareEditorFromSessionDetail, seedShareDraft } from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('Shares card click-twice deletes; Undo toast restores', async () => {
  const { window } = ctx
  await waitForSync(window)
  await seedShareDraft(window, { title: 'Delete-and-undo draft' })
  await navigateToShares(window)

  const card = window
    .locator('[data-testid="shares-draft-row"][aria-label="Open Delete-and-undo draft"]')
    .first()
  await expect(card).toBeVisible({ timeout: 5000 })
  // Hover the wrapping <div>, not the inner <button>, so React's
  // onMouseEnter on the wrapper fires and the DeleteChip mounts.
  const wrapper = card.locator('xpath=..')
  await wrapper.hover()
  const deleteChip = wrapper.locator('[data-testid="shares-draft-delete"]')
  await expect(deleteChip).toBeVisible({ timeout: 5000 })
  // First click — primes the confirm pill.
  await deleteChip.click()
  await expect(deleteChip).toHaveAttribute('data-confirming', '')
  // Second click — actually deletes.
  await deleteChip.click()
  await expect(card).toBeHidden({ timeout: 5000 })

  // Undo from the sonner toast.
  await window.getByRole('button', { name: 'Undo' }).click()
  await expect(
    window.locator('[data-testid="shares-draft-row"][aria-label="Open Delete-and-undo draft"]'),
  ).toBeVisible({ timeout: 5000 })
})

test('editor topbar delete modal closes the editor and removes the draft', async () => {
  const { window } = ctx
  await openShareEditorFromSessionDetail(window, SESSION_UUID)

  await window.locator('[data-testid="share-editor-more"]').click()
  await window.getByRole('menuitem', { name: 'Delete draft' }).click()
  await expect(window.locator('[data-testid="delete-draft-modal"]')).toBeVisible({ timeout: 5000 })
  await window.locator('[data-testid="delete-draft-confirm"]').click()

  // Editor should close; navigation lands back on the session detail.
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeHidden({ timeout: 5000 })

  // The session-derived draft should not appear on Shares.
  await navigateToShares(window)
  await expect(
    window.locator(`[data-testid="shares-draft-row"]`).filter({ hasText: /XYLOPHONE|test-session-001/ }),
  ).toHaveCount(0)
})

import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  buildSampleSpoolDocument,
  dropFileOn,
  navigateToShares,
} from './helpers/share'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('drop .spool on Shares opens editor with imported content', async () => {
  const { window } = ctx
  await waitForSync(window)
  await navigateToShares(window)

  const spool = buildSampleSpoolDocument({ title: 'Imported sample one' })
  await dropFileOn(window, '[data-testid="shares-page"]', 'sample-one.spool', spool)
  // The drop hook is wired on the SharesPage root; dropping on the empty
  // state's button bubbles up to the same handler.
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
  await expect(window.locator('[data-testid="share-editor-title"]')).toHaveText('Imported sample one')
})

test('dropping the same content again opens the same draft (content-hash dedup)', async () => {
  const { window } = ctx
  // Capture the current draft id from the persisted snapshot by inspecting
  // a stable signal: the draft title round-trips through the editor.
  // Back out, then re-drop the identical bytes — there should still be
  // exactly one row in the Shares grid.
  await window.getByRole('button', { name: 'Back' }).first().click()
  await navigateToShares(window)

  await expect(window.locator('[data-testid="shares-draft-row"]')).toHaveCount(1)

  const same = buildSampleSpoolDocument({ title: 'Imported sample one' })
  await dropFileOn(window, '[data-testid="shares-page"]', 'sample-one.spool', same)
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
  await window.getByRole('button', { name: 'Back' }).first().click()
  await expect(window.locator('[data-testid="shares-draft-row"]')).toHaveCount(1)
})

test('dropping a non-.spool file surfaces a reject toast', async () => {
  const { window } = ctx
  await dropFileOn(
    window,
    '[data-testid="shares-page"]',
    'not-a-spool.txt',
    'plain text body',
    'text/plain',
  )
  await expect(window.getByText(/Couldn't import not-a-spool\.txt/)).toBeVisible({ timeout: 5000 })
})

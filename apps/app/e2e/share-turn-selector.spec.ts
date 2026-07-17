import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail } from './helpers/share'

let ctx: AppContext

// Use the large fixture so we have plenty of turns to select / skip.
const SESSION_UUID = 'large-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('switch to Messages view, exclude turns, see preview reflect change', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)

  // The large fixture exceeds the preview's first progressive chunk, so
  // wait for the full document to commit before taking DOM baselines —
  // counting anchors mid-fill would race the chunked mount.
  await expect(
    window.locator('[data-testid="share-preview-render"][data-render-complete]'),
  ).toBeVisible({ timeout: 15_000 })

  // Switch to Messages view on the right ControlPanel.
  await window.locator('[data-testid="share-editor-view-messages"]').click()
  const firstRow = window.locator('[data-testid="share-editor-turn-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })

  // With the fill complete, the preview holds the whole conversation.
  // We count its turn anchors as a baseline.
  const previewTurns = window.locator('[data-share-preview-scroll] [data-turn-index]')
  const startCount = await previewTurns.count()
  expect(startCount).toBeGreaterThan(0)

  // Exclude the first turn (toggle from included → excluded).
  await window.locator('[data-testid="share-editor-turn-toggle"]').first().click()
  await expect(firstRow).not.toHaveAttribute('data-included', '')

  // The preview now has one fewer rendered turn (or, with showGaps on,
  // the same number but with a "skipped" marker — share-kit renders a
  // gap row between non-adjacent kept turns). Either way the original
  // 0-index anchor should disappear, since the excluded turn doesn't
  // render its body.
  await expect(window.locator('[data-share-preview-scroll] [data-turn-index="0"]')).toHaveCount(0)
})

test('Select all restores the full set; Clear excludes everything', async () => {
  const { window } = ctx
  await window.locator('[data-testid="share-editor-turns-select-all"]').click()
  await expect(
    window.locator('[data-testid="share-editor-turn-row"][data-included=""]').first(),
  ).toBeVisible()
  // Every row should now report included.
  const rows = window.locator('[data-testid="share-editor-turn-row"]')
  const total = await rows.count()
  expect(total).toBeGreaterThan(0)
  for (let i = 0; i < Math.min(total, 5); i += 1) {
    await expect(rows.nth(i)).toHaveAttribute('data-included', '')
  }

  await window.locator('[data-testid="share-editor-turns-clear"]').click()
  // After clear, no row is included.
  for (let i = 0; i < Math.min(total, 5); i += 1) {
    await expect(rows.nth(i)).not.toHaveAttribute('data-included', '')
  }
})

test('Jump scrolls the preview to the selected turn', async () => {
  const { window } = ctx
  await window.locator('[data-testid="share-editor-turns-select-all"]').click()

  // Pick a turn well past the initial viewport.
  const target = window.locator('[data-testid="share-editor-turn-jump"][data-row-turn-index="20"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await target.click()
  // After jump the preview's data-turn-index="20" should have scrolled
  // into view.
  const anchor = window.locator('[data-share-preview-scroll] [data-turn-index="20"]')
  await expect(anchor).toBeVisible({ timeout: 5000 })
})

import { test, expect } from '@playwright/test'
import { launchAppWithGpu, type AppContext } from './helpers/launch-with-gpu'
import { openShareEditorFromSessionDetail } from './helpers/share'
import { waitForSync } from './helpers/launch'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Diagnostic for the PDF preview iframe path with full GPU enabled.
// Chromium's built-in PDF viewer needs GPU rasterisation; the regular
// launchApp helper sets ELECTRON_DISABLE_GPU=1 which makes the iframe
// paint grey regardless. This spec runs with GPU on so we can prove
// whether CSP is the only thing blocking the viewer.

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'
const ARTIFACT_PATH = join(__dirname, '..', 'e2e-output', 'pdf-iframe-with-gpu.png')

test.beforeAll(async () => {
  test.setTimeout(180_000)
  ctx = await launchAppWithGpu()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('PDF iframe renders with GPU enabled', async () => {
  test.setTimeout(180_000)
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)

  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
  // The tab strip is only rendered when VITE_FEATURE_SHAREPUBLISH is on;
  // e2e runs with publish disabled, so the popover opens directly on the
  // Export tab and there's no tab button to click first.
  const exportTab = window.locator('[data-testid="share-menu-tab-export"]')
  if (await exportTab.count()) await exportTab.click()
  await window.locator('[data-testid="share-menu-export-pdf"]').click()
  await window.locator('[data-testid="share-menu-download"]').click()

  const iframe = window.locator('iframe[title]').first()
  await expect(iframe).toBeVisible({ timeout: 30_000 })

  // Generous wait for Chromium's PDF viewer to attach + paint.
  await window.waitForTimeout(5000)

  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true })
  await window
    .locator('.fixed.inset-0.z-50')
    .screenshot({ path: ARTIFACT_PATH })
})

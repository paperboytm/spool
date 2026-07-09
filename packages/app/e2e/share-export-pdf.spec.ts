import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  installSaveFilePickerMock,
  openShareEditorFromSessionDetail,
  waitForSavedFile,
} from './helpers/share'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// End-to-end regression for the PDF export pipeline: the renderer
// serializes the preview DOM, main renders it in a hidden SANDBOXED
// BrowserWindow (spool:print-to-pdf) and returns printToPDF bytes,
// the renderer shows the preview modal, and "Save PDF" writes the
// bytes through the save picker. Asserting on the saved bytes proves
// the sandboxed print window actually produced a valid PDF — guarding
// the sandbox:false → sandbox:true hardening against silent breakage.

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'
const ARTIFACT_PATH = join(__dirname, '..', 'e2e-output', 'share-export-pdf.png')

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('PDF export produces a valid PDF through the sandboxed print window', async () => {
  test.setTimeout(120_000)
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  await installSaveFilePickerMock(window)

  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
  const exportTab = window.locator('[data-testid="share-menu-tab-export"]')
  if (await exportTab.count()) await exportTab.click()
  await window.locator('[data-testid="share-menu-export-pdf"]').click()
  await window.locator('[data-testid="share-menu-download"]').click()

  // The preview modal only appears after main's print window has
  // loaded the renderer URL, executed the injected artifact swap, and
  // returned printToPDF bytes — so its visibility already proves the
  // sandboxed pipeline completed.
  const saveButton = window.locator('[data-testid="pdf-preview-save"]')
  await expect(saveButton).toBeVisible({ timeout: 60_000 })

  mkdirSync(dirname(ARTIFACT_PATH), { recursive: true })
  await window.screenshot({ path: ARTIFACT_PATH })

  await saveButton.click()
  const saved = await waitForSavedFile(window, '.pdf')

  expect(saved.filename).toMatch(/\.pdf$/)
  assertValidPdf(saved.bytes)
  writeFileSync(join(dirname(ARTIFACT_PATH), 'share-export-pdf.pdf'), saved.bytes)

  // Second export in the same session: the print window is created and
  // destroyed per export, so a repeat run guards the teardown path
  // (a leaked/broken hidden window would hang or corrupt this pass).
  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
  if (await exportTab.count()) await exportTab.click()
  await window.locator('[data-testid="share-menu-export-pdf"]').click()
  await window.locator('[data-testid="share-menu-download"]').click()
  await expect(saveButton).toBeVisible({ timeout: 60_000 })
  await saveButton.click()
  const savedAgain = await waitForSavedFile(window, '.pdf')
  assertValidPdf(savedAgain.bytes)
})

function assertValidPdf(bytes: Uint8Array): void {
  // %PDF-x.y header — the definitive "these bytes are a PDF" check.
  const head = new TextDecoder().decode(bytes.slice(0, 8))
  expect(head).toMatch(/^%PDF-\d\.\d/)
  // EOF marker near the tail, and a size that implies real page content.
  const tail = new TextDecoder().decode(bytes.slice(-32))
  expect(tail).toContain('%%EOF')
  expect(bytes.byteLength).toBeGreaterThan(1000)
}

import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { openShareEditorFromSessionDetail } from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

// `mod` resolves to ⌘ on macOS and Ctrl elsewhere, matching what
// useHotkeys binds in the renderer. Playwright's keypress strings use
// "Meta" / "Control" — we pick the right one per platform.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('share editor opens from SessionDetail with default opts', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  const preview = window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await expect(preview).toHaveAttribute('data-paper', 'snow')
  await expect(preview).toHaveAttribute('data-typeface', 'inter')
  await expect(preview).toHaveAttribute('data-colorway', 'amber')
})

test('template / typeface / paper / colorway switches reflect in preview', async () => {
  const { window } = ctx
  const preview = window.locator('[data-testid="share-preview-render"]')

  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await expect(preview).toHaveAttribute('data-template', 'letter')

  await window.locator('[data-testid="share-editor-typeface-fraunces"]').click()
  await expect(preview).toHaveAttribute('data-typeface', 'fraunces')

  await window.locator('[data-testid="share-editor-paper-bone"]').click()
  await expect(preview).toHaveAttribute('data-paper', 'bone')

  await window.locator('[data-testid="share-editor-colorway-marine"]').click()
  await expect(preview).toHaveAttribute('data-colorway', 'marine')

  await window.locator('[data-testid="share-editor-density-relaxed"]').click()
  await expect(preview).toHaveAttribute('data-density', 'relaxed')
})

test('chrome toggles (masthead, colophon, hideEmptyTurns, showGaps) flip aria-checked', async () => {
  const { window } = ctx
  // Each toggle is a role="switch" with aria-checked reflecting state.
  const ids = ['hideEmptyTurns', 'showGaps', 'showMasthead', 'showColophon']
  for (const key of ids) {
    const sel = `[data-testid="share-editor-toggle-${key}"]`
    const before = await window.locator(sel).getAttribute('aria-checked')
    await window.locator(sel).click()
    const after = await window.locator(sel).getAttribute('aria-checked')
    expect(after).not.toBe(before)
    // Flip back so subsequent tests start from defaults-on.
    await window.locator(sel).click()
    const final = await window.locator(sel).getAttribute('aria-checked')
    expect(final).toBe(before)
  }
})

test('Cmd+Z undoes the last opts change; Cmd+Shift+Z redoes it', async () => {
  const { window } = ctx
  // Editor is left open by prior tests in this file; do not call
  // openShareEditorFromSessionDetail (its sidebar click would be
  // intercepted by the editor's right panel).
  const preview = window.locator('[data-testid="share-preview-render"]')

  // Settle on chat, wait past the coalesce window, change to letter.
  // Two distinct undo entries: (chat) → (letter).
  await window.locator('[data-testid="share-editor-template-chat"]').click()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await window.waitForTimeout(600)
  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await expect(preview).toHaveAttribute('data-template', 'letter')

  await window.keyboard.press(`${MOD}+z`)
  await expect(preview).toHaveAttribute('data-template', 'chat', { timeout: 2000 })

  await window.keyboard.press(`${MOD}+Shift+z`)
  await expect(preview).toHaveAttribute('data-template', 'letter', { timeout: 2000 })
})

test('rapid clicks within the coalesce window collapse into one undo step', async () => {
  const { window } = ctx
  const preview = window.locator('[data-testid="share-preview-render"]')

  // Settle on a known starting template; gap so the next chain begins
  // a fresh undo entry.
  await window.locator('[data-testid="share-editor-template-chat"]').click()
  await expect(preview).toHaveAttribute('data-template', 'chat')
  await window.waitForTimeout(600)

  // Three rapid switches within the 500ms coalesce window collapse
  // into a single undo step that returns to 'chat'.
  await window.locator('[data-testid="share-editor-template-letter"]').click()
  await window.locator('[data-testid="share-editor-template-forum"]').click()
  await window.locator('[data-testid="share-editor-template-timeline"]').click()
  await expect(preview).toHaveAttribute('data-template', 'timeline')

  await window.keyboard.press(`${MOD}+z`)
  await expect(preview).toHaveAttribute('data-template', 'chat', { timeout: 2000 })
})

test('Cmd+= / Cmd+- / Cmd+0 step zoom in / out / back to fit', async () => {
  const { window } = ctx
  const canvas = window.locator('[data-testid="share-preview-canvas"]')

  // Snap to fit as the starting baseline — the editor opens at fit, but
  // prior tests may have left a custom step in place.
  await window.keyboard.press(`${MOD}+0`)
  await expect(canvas).toHaveAttribute('data-zoom', 'fit', { timeout: 2000 })

  // ⌘+ (key='+', shifted-equals on US layout) snaps to a discrete step
  // (the ZOOM_STEPS scale; first step at or above current).
  await window.keyboard.press(`${MOD}+Shift+Equal`)
  await expect(canvas).not.toHaveAttribute('data-zoom', 'fit', { timeout: 2000 })
  const afterIn = await canvas.getAttribute('data-zoom')
  expect(Number(afterIn)).toBeGreaterThan(0)

  // ⌘- steps back down. With only one step above fit captured, this
  // returns to the next-lower discrete step (not back to fit).
  await window.keyboard.press(`${MOD}+Minus`)
  const afterOut = await canvas.getAttribute('data-zoom')
  expect(Number(afterOut)).toBeLessThan(Number(afterIn))

  // ⌘0 snaps back to fit regardless of where we are.
  await window.keyboard.press(`${MOD}+0`)
  await expect(canvas).toHaveAttribute('data-zoom', 'fit', { timeout: 2000 })
})

test('zoom shortcut is suppressed when focus is in a control-panel input', async () => {
  const { window } = ctx
  const canvas = window.locator('[data-testid="share-preview-canvas"]')

  // Start at fit.
  await window.keyboard.press(`${MOD}+0`)
  await expect(canvas).toHaveAttribute('data-zoom', 'fit', { timeout: 2000 })

  // Focus an editable surface (the rename input is the simplest one —
  // open the rename modal, focus its input, then press ⌘= which would
  // normally zoom). The skipInEditable guard means zoom stays at fit.
  await window.locator('[data-testid="share-editor-more"]').click()
  await window.getByRole('menuitem', { name: 'Rename draft' }).click()
  const renameInput = window.locator('[data-testid="rename-draft-input"]')
  await expect(renameInput).toBeFocused({ timeout: 2000 })

  await window.keyboard.press(`${MOD}+Shift+Equal`)
  await expect(canvas).toHaveAttribute('data-zoom', 'fit')

  // Dismiss the rename modal so subsequent tests start clean.
  await window.getByRole('button', { name: 'Cancel' }).click()
  await expect(window.locator('[data-testid="rename-draft-modal"]')).toBeHidden({ timeout: 2000 })
})

test('Back returns to SessionDetail', async () => {
  const { window } = ctx
  await window.getByRole('button', { name: 'Back' }).first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })
})

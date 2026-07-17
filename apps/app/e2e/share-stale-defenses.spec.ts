import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { dropFileOn, navigateToShares, seedShareDraft } from './helpers/share'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('opening a draft with retired template / paper / colorway ids coerces to defaults — no white screen', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Seed a draft whose snapshot carries pre-v0.5.0 ids that the share
  // editor has since retired:
  //   - template: 'interview' (removed in #207 along with the file)
  //   - paper: 'linen'        (removed in #209)
  //   - colorway: 'ink'       (removed in #207 in favor of walnut)
  // normalizeOpts should coerce each back to its default on load.
  const draftId = await seedShareDraft(window, {
    title: 'Stale snapshot regression',
    opts: {
      template: 'interview',
      paper: 'linen',
      typeface: 'inter',
      colorway: 'ink',
      accentHex: '#1C1C18',
      density: 'compact',
      redact: true,
      showGaps: true,
      showMasthead: true,
      showColophon: true,
      hideEmptyTurns: true,
    },
  })
  expect(draftId).toBeTruthy()

  await navigateToShares(window)
  const card = window
    .locator('[data-testid="shares-draft-row"][aria-label="Open Stale snapshot regression"]')
    .first()
  await expect(card).toBeVisible({ timeout: 5000 })
  await card.click()

  // Editor must render, NOT white-screen. The preview's data attrs are
  // the cleanest signal of what normalizeOpts coerced the stale ids to.
  const preview = window.locator('[data-testid="share-preview-render"]')
  await expect(preview).toBeVisible({ timeout: 5000 })
  await expect(preview).toHaveAttribute('data-template', 'chat')
  // 'linen' coerces to whatever DEFAULT_OPTS.paper is (currently snow).
  await expect(preview).toHaveAttribute('data-paper', /^(snow|bone|graphite|ink)$/)
  // 'ink' colorway coerces to amber and the accent swatch resets too.
  await expect(preview).toHaveAttribute('data-colorway', 'amber')

  // Cleanup: leave a clean state for any tests that follow.
  await window.getByRole('button', { name: 'Back' }).first().click()
})

test('dropping a malformed .spool file surfaces a reject toast and does not crash the editor', async () => {
  const { window } = ctx
  await navigateToShares(window)

  // .spool extension but content is not valid JSON — readSpoolFile
  // should reject, the host should show a "Couldn't import" toast,
  // and the Shares page should keep rendering normally.
  await dropFileOn(
    window,
    '[data-testid="shares-page"]',
    'busted.spool',
    'this is not valid json {[}]',
    'application/spool+json',
  )

  await expect(window.getByText(/Couldn't import busted\.spool/)).toBeVisible({ timeout: 5000 })

  // No editor opened (the import failed before openShareEditor would
  // have fired) — the Shares page is still the active surface.
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeHidden()
  await expect(window.locator('[data-testid="shares-page"]')).toBeVisible()
})

test('dropping a .spool with valid JSON but missing required fields surfaces a reject toast', async () => {
  const { window } = ctx
  // JSON-parseable but doesn't match the SpoolDocument schema —
  // readSpoolFile should reject on the validation step rather than
  // letting a half-shaped doc into the editor.
  await dropFileOn(
    window,
    '[data-testid="shares-page"]',
    'shape-mismatch.spool',
    JSON.stringify({ version: 1, hello: 'world' }),
    'application/spool+json',
  )

  await expect(window.getByText(/Couldn't import shape-mismatch\.spool/)).toBeVisible({ timeout: 5000 })
  await expect(window.locator('[data-testid="share-editor-page"]')).toBeHidden()
})

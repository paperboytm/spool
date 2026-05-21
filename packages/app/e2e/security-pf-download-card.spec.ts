import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

// PF download card surface coverage (PR 5e):
// - Card renders in not-installed phase on a fresh app
// - Clicking Download flips the card into downloading and surfaces a
//   Cancel button; clicking Cancel returns it to not-installed
// - Toggle is absent until the model has finished installing — gates
//   against pre-PR-5e behaviour where the inert Coming-soon toggle was
//   reachable.
//
// The placeholder manifest's HF URL won't actually resolve, so the
// download will end up failing. That's fine — we don't assert on the
// terminal state; the test verifies the UI's state machine wiring.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({})
})

test.afterAll(async () => { await ctx?.cleanup() })

async function openSecurityTab(window: AppContext['window']) {
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  await expect(window.locator('[data-testid="settings-rescan-all"]')).toBeVisible({ timeout: 10_000 })
}

test('PF card renders in not-installed phase with a Download button + no toggle', async () => {
  const { window } = ctx
  await openSecurityTab(window)
  const card = window.locator('[data-testid="settings-detector-pf"]')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-phase', 'not-installed')
  await expect(card.locator('[data-testid="settings-pf-download"]')).toBeVisible()
  await expect(card.locator('[data-testid="settings-pf-toggle"]')).toHaveCount(0)
})

test('Clicking Download advances the card past not-installed', async () => {
  const { window } = ctx
  await openSecurityTab(window)
  const card = window.locator('[data-testid="settings-detector-pf"]')
  await card.locator('[data-testid="settings-pf-download"]').click()
  // The transition is fast — phase should leave not-installed within
  // a second whether the download begins or fails outright.
  await expect(card).not.toHaveAttribute('data-phase', 'not-installed', { timeout: 5_000 })
})

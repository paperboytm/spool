import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// Regression: when a Security pref is persisted as `true`, opening the
// Security tab USED to render the corresponding toggle in its `??`
// fallback ('false') for a few ms before the async getPrefs() resolved
// and flipped it to 'true' — users saw the switch sweep on every tab
// open. The fix gates the entire pane body behind `prefs !== null`, so
// the toggle never enters the DOM in its fallback state.
//
// This spec wires a MutationObserver before navigating, so we can
// catch a transient `aria-checked="false"` even if it lasts a single
// frame. The observer watches the entire Settings panel subtree, so
// the assertion is target-specific (settings-blur-page) but immune to
// the parent's exact tree shape.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => { await ctx?.cleanup() })

test('Security toggles never render in fallback off-state when the pref is on', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Seed the pref so a flash would be visible (default is false; the
  // fallback also lands at false, so the flash needs `true` to surface).
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: { setPrefs: (p: { securityPageValuesBlurred: boolean }) => Promise<unknown> } } }).spool?.security
    await api!.setPrefs({ securityPageValuesBlurred: true })
  })

  // Arm a MutationObserver BEFORE opening Settings. It records any
  // moment the target toggle is in `aria-checked="false"`, regardless
  // of whether it arrived that way or was attribute-flipped to it.
  await window.evaluate(() => {
    type Holder = { __flashSeen?: boolean; __flashObs?: MutationObserver }
    const w = window as unknown as Holder
    w.__flashSeen = false
    const check = () => {
      const t = document.querySelector('[data-testid="settings-blur-page"]')
      if (t && t.getAttribute('aria-checked') === 'false') {
        w.__flashSeen = true
      }
    }
    const obs = new MutationObserver(check)
    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked'],
    })
    w.__flashObs = obs
  })

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()

  // Wait for the toggle to mount — at this point, if the bug were
  // present, the observer would have caught the transient false state.
  const blurPage = window.locator('[data-testid="settings-blur-page"]')
  await expect(blurPage).toBeVisible({ timeout: 10_000 })
  await expect(blurPage).toHaveAttribute('aria-checked', 'true')

  const sawFlash = await window.evaluate(() => {
    type Holder = { __flashSeen?: boolean; __flashObs?: MutationObserver }
    const w = window as unknown as Holder
    w.__flashObs?.disconnect()
    return w.__flashSeen === true
  })
  expect(sawFlash, 'toggle was rendered in aria-checked="false" before its persisted true state arrived').toBe(false)

  // Reset so we don't leave the user-data dir in a non-default state
  // for any follow-up tests in this file.
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: { setPrefs: (p: { securityPageValuesBlurred: boolean }) => Promise<unknown> } } }).spool?.security
    await api!.setPrefs({ securityPageValuesBlurred: false })
  })
})

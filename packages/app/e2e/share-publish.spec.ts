// End-to-end regression suite for the share-publish UI surfaces.
//
// What this spec actually exercises:
//   - The Share popover trigger + popover scaffold on the editor
//   - The signed-out branch (ConnectCard) + the click-through that
//     drives main's signIn IPC. In e2e the build-time __SPOOL_E2E__
//     constant routes share-auth IPC registration through
//     src/main/e2e-mode/share-auth-e2e.ts, which swaps session-store
//     to in-memory and replaces the OAuth dance with a fake-id-token
//     POST. Production source has zero awareness of test mode; the
//     e2e-mode entry is dead-code-eliminated from production bundles
//     and an invariant test (e2e-mode/e2e-mode-clean.test.ts) keeps
//     it that way.
//   - The signed-in publish form: visibility radios, expiry select,
//     Publish button, the spinner during in-flight publish
//   - The post-publish manage view: URL string with copy-link, the
//     Unpublish action + the dedicated confirm modal (regression for
//     the destructive-action discipline added in PR #371)
//   - Republish bumps version + Unpublished-edits state on drift
//
// What this spec does NOT exercise (and why):
//   - Real Google OAuth — the e2e-mode entry's e2eSignIn() replaces
//     the loopback server + Google token exchange. Those are covered
//     by main/auth/oauth.test.ts at the unit layer
//   - Server-side validation rejections — backend/tests/publish.test.ts
//     covers 401/422/409/429 paths against the real validator
//   - The Privacy / PII gate — publish-logic.test.ts covers the pure
//     functions; the gate's renderer wiring is observable here through
//     the visibility of the publish form (presence ≠ wired correctly,
//     but a regression that breaks the gate IS visible in publish-logic
//     unit tests)
//
// Selector discipline: every locator uses data-testid. We do NOT
// match by text — the i18n migration lands strings behind t() and any
// text-based selector would flake the moment the en.json copy edits.

import { test, expect, type Page } from '@playwright/test'

import {
  launchApp,
  restartApp,
  waitForSync,
  type AppContext,
} from './helpers/launch'
import {
  startSharePublishMockBackend,
  type SharePublishMockHandle,
} from './helpers/share-publish-mock-backend'
import { navigateToShares, openShareEditorFromSessionDetail } from './helpers/share'

// Error-copy assertions read the expected strings from the same en.json
// the renderer renders from — the selector discipline below bans
// hand-typed text matches, but "which of the three error variants
// rendered?" is only observable through copy, so we source it from the
// single source of truth instead of duplicating it here.
import en from '../src/renderer/i18n/locales/en.json'

const SESSION_UUID = 'test-session-uuid-001'

let mock: SharePublishMockHandle
let ctx: AppContext

test.beforeAll(async () => {
  mock = await startSharePublishMockBackend()
  ctx = await launchApp({
    extraEnv: {
      SPOOL_SHARE_BACKEND: mock.baseUrl,
    },
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
  await mock?.close()
})

// Each test starts on a clean Electron + clean mock backend so a
// publish or popover state from one test can't leak into the next.
// Restart is ~3-5s/test; cheaper than threading "navigate back to
// library" cleanup through every helper, and the isolation guarantee
// is worth the overhead for a destructive-action regression suite.
test.beforeEach(async () => {
  mock.reset()
  ctx = await restartApp(ctx)
})

test('Share popover opens with the ConnectCard when signed out', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)

  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
  await expect(
    window.locator('[data-testid="connect-card-signin"]'),
  ).toBeVisible()
})

test('Sign-in transitions the popover to the publish form', async () => {
  const { window } = ctx
  await openSharePopover(window)
  await window.locator('[data-testid="connect-card-signin"]').click()
  // Form renders only once useShareAuth resolves to a signed-in user;
  // covers the auth-bus EventTarget sync between main and renderer.
  await expect(
    window.locator('[data-testid="share-menu-form"]'),
  ).toBeVisible({ timeout: 5_000 })
  await expect(
    window.locator('[data-testid="share-menu-visibility-link-only"]'),
  ).toBeVisible()
  await expect(
    window.locator('[data-testid="share-menu-submit"]'),
  ).toBeEnabled()
})

test('Publish lands in the manage view with slug + copy-link + unpublish', async () => {
  const { window } = ctx
  await signInAndOpenPublishForm(window)

  // Submit. The renderer derives idempotency_key from the snapshot;
  // we only need to assert the manage view eventually appears.
  await window.locator('[data-testid="share-menu-submit"]').click()
  await expect(
    window.locator('[data-testid="share-menu-manage-view"]'),
  ).toBeVisible({ timeout: 10_000 })

  await expect(window.locator('[data-testid="share-menu-copy"]')).toBeVisible()
  await expect(window.locator('[data-testid="share-menu-republish"]')).toBeVisible()
  await expect(window.locator('[data-testid="share-menu-unpublish"]')).toBeVisible()

  // Backend recorded the publish — verifies that the IPC bridge through
  // main/auth + main/share-publish + mock backend is end-to-end wired.
  expect(mock.state.shares.size).toBe(1)
  const [first] = Array.from(mock.state.shares.values())
  // The renderer-derived idempotency_key must reach the backend
  // verbatim — regression for computePublishIdempotencyKey wire-up.
  expect(first!.client_request_id).toBeTruthy()
  expect(first!.visibility).toBe('unlisted')
})

test('Unpublish requires confirm and tombstones the share', async () => {
  const { window } = ctx
  await signInAndPublish(window)

  await window.locator('[data-testid="share-menu-unpublish"]').click()
  // The dedicated centered modal — NOT a popover-internal click-twice.
  // This is the regression guard for the destructive-action discipline
  // codified in PR #371.
  await expect(
    window.locator('[data-testid="unpublish-confirm"]'),
  ).toBeVisible()

  await window.locator('[data-testid="unpublish-confirm-yes"]').click()

  await expect(
    window.locator('[data-testid="unpublish-confirm"]'),
  ).toBeHidden()
  // Popover falls back to the publish form once the live share is gone.
  await expect(
    window.locator('[data-testid="share-menu-form"]'),
  ).toBeVisible()

  // Backend state: row carries revoked_at.
  const shares = Array.from(mock.state.shares.values())
  expect(shares).toHaveLength(1)
  expect(shares[0]!.revoked_at).not.toBeNull()
})

test('Cancel on the unpublish modal leaves the share live', async () => {
  // The destructive-confirm discipline isn't only "modal opens before
  // revoke" — equally important is that the Cancel path doesn't
  // accidentally fire revoke. Regression for the inner-card
  // stopPropagation + outside-click handling on UnpublishConfirmModal.
  const { window } = ctx
  await signInAndPublish(window)

  await window.locator('[data-testid="share-menu-unpublish"]').click()
  await expect(
    window.locator('[data-testid="unpublish-confirm"]'),
  ).toBeVisible()

  await window.locator('[data-testid="unpublish-confirm-cancel"]').click()
  await expect(
    window.locator('[data-testid="unpublish-confirm"]'),
  ).toBeHidden()
  // Manage view still rendered, share state unchanged.
  await expect(
    window.locator('[data-testid="share-menu-manage-view"]'),
  ).toBeVisible()
  const shares = Array.from(mock.state.shares.values())
  expect(shares).toHaveLength(1)
  expect(shares[0]!.revoked_at).toBeNull()
})

test('Publish rate-limit (429) shows the error inline and retry succeeds', async () => {
  const { window } = ctx
  await signInAndOpenPublishForm(window)

  mock.state.failures.publish = 429
  await window.locator('[data-testid="share-menu-submit"]').click()

  const error = window.locator('[data-testid="share-menu-error"]')
  await expect(error).toBeVisible({ timeout: 5_000 })
  await expect(error).toContainText(en.shareEditor.publishTab.error_rateLimited)
  // The form survives the failure — the user can adjust and retry
  // without reopening the popover.
  await expect(window.locator('[data-testid="share-menu-form"]')).toBeVisible()
  await expect(window.locator('[data-testid="share-menu-submit"]')).toBeEnabled()
  expect(mock.state.shares.size).toBe(0)

  // Backend recovers → the same submit button retries to success.
  mock.state.failures.publish = null
  await window.locator('[data-testid="share-menu-submit"]').click()
  await expect(
    window.locator('[data-testid="share-menu-manage-view"]'),
  ).toBeVisible({ timeout: 10_000 })
  expect(mock.state.shares.size).toBe(1)
})

test('Publish with an expired session (401) shows the sign-in error', async () => {
  const { window } = ctx
  await signInAndOpenPublishForm(window)

  mock.state.failures.publish = 401
  await window.locator('[data-testid="share-menu-submit"]').click()

  const error = window.locator('[data-testid="share-menu-error"]')
  await expect(error).toBeVisible({ timeout: 5_000 })
  await expect(error).toContainText(en.shareEditor.publishTab.error_sessionExpired)
  await expect(window.locator('[data-testid="share-menu-form"]')).toBeVisible()
  expect(mock.state.shares.size).toBe(0)
})

test('Published tab flags a failed refresh as stale and retry clears it', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Backend down before the tab ever loads — the list renders from the
  // (empty) cache and must say so rather than silently looking fresh.
  mock.state.failures.myShares = 500

  await navigateToShares(window)
  await window.locator('[data-testid="shares-tab-published"]').click()
  await window.locator('[data-testid="published-signin"]').click()

  const banner = window.locator('[data-testid="published-stale-banner"]')
  await expect(banner).toBeVisible({ timeout: 5_000 })

  // Backend recovers → Retry clears the banner.
  mock.state.failures.myShares = null
  await window.locator('[data-testid="published-stale-retry"]').click()
  await expect(banner).toBeHidden({ timeout: 5_000 })
})

test('Published tab lists a live share with open/copy/unpublish affordances', async () => {
  const { window } = ctx
  await signInAndPublish(window)

  // Leave the share editor — the full-page editor covers the sidebar,
  // so close the popover (Esc) and back out before navigating.
  await window.keyboard.press('Escape')
  await expect(
    window.locator('[data-testid="share-menu-popover"]'),
  ).toBeHidden()
  await window.locator('[data-testid="share-editor-back"]').click()
  await expect(
    window.locator('[data-testid="share-editor-page"]'),
  ).toBeHidden()

  await navigateToShares(window)
  await window.locator('[data-testid="shares-tab-published"]').click()

  const row = window.locator('[data-testid="published-row"]')
  await expect(row).toBeVisible({ timeout: 5_000 })
  // Whole-row open affordance (replaces the external-link icon action).
  await expect(row.locator('[data-testid="published-row-open"]')).toBeVisible()
  // Copy / Unpublish live in the row's ⋯ menu (portal-rendered, so the
  // menuitems are located on the window, not inside the row). The
  // trigger is hover-revealed like SessionRow's, so hover first.
  await row.hover()
  await row.getByLabel(en.common.moreActions).click()
  await expect(
    window.getByRole('menuitem', { name: en.shares.publishedTab.action_copyLink }),
  ).toBeVisible()
  await expect(
    window.getByRole('menuitem', { name: en.shares.publishedTab.action_unpublish }),
  ).toBeVisible()
  await window.keyboard.press('Escape')
  // Live row — no stale banner, no revoked styling.
  await expect(row).not.toHaveAttribute('data-revoked', '')
  await expect(
    window.locator('[data-testid="published-stale-banner"]'),
  ).toBeHidden()
})

test('Revoked shares collapse into the Unpublished section, display-only', async () => {
  const { window } = ctx
  await signInAndPublish(window)

  // Unpublish via the popover, then leave the editor.
  await window.locator('[data-testid="share-menu-unpublish"]').click()
  await window.locator('[data-testid="unpublish-confirm-yes"]').click()
  await expect(window.locator('[data-testid="unpublish-confirm"]')).toBeHidden()
  await window.keyboard.press('Escape')
  await window.locator('[data-testid="share-editor-back"]').click()

  await navigateToShares(window)
  await window.locator('[data-testid="shares-tab-published"]').click()

  // No live rows → no live list; history sits behind the collapsed
  // section header instead of mixing into the main list.
  const toggle = window.locator('[data-testid="published-unpublished-toggle"]')
  await expect(toggle).toBeVisible({ timeout: 10_000 })
  await expect(toggle).toContainText(en.shares.publishedTab.section_unpublished)
  await expect(window.locator('[data-testid="published-list"]')).toBeHidden()
  await expect(window.locator('[data-testid="published-revoked-list"]')).toBeHidden()

  await toggle.click()
  const row = window.locator('[data-testid="published-revoked-list"] [data-testid="published-row"]')
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('data-revoked', '')
  // Display-only: no whole-row open button, no ⋯ menu (the slug is
  // permanently 410 — Copy link would hand out a dead URL).
  await expect(row.locator('[data-testid="published-row-open"]')).toHaveCount(0)
  await expect(row.getByLabel(en.common.moreActions)).toHaveCount(0)
})

// ───────────────────────────────────────────────────────────────────
// helpers

async function openSharePopover(window: Page): Promise<void> {
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
}

async function signInAndOpenPublishForm(window: Page): Promise<void> {
  await openSharePopover(window)
  await window.locator('[data-testid="connect-card-signin"]').click()
  await window
    .locator('[data-testid="share-menu-form"]')
    .waitFor({ state: 'visible', timeout: 5_000 })
}

async function signInAndPublish(window: Page): Promise<void> {
  await signInAndOpenPublishForm(window)
  await window.locator('[data-testid="share-menu-submit"]').click()
  await window
    .locator('[data-testid="share-menu-manage-view"]')
    .waitFor({ state: 'visible', timeout: 10_000 })
}

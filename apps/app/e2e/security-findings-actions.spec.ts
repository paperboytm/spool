import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Covers the unified findings-action surface work (2026-05):
//
//   * FindingsStrip dedupes identical (kind, value) occurrences into one
//     row with an ×N badge.
//   * Per-row Dismiss (scope menu) + Purge actions on strip rows.
//   * Session-scoped bulk (Dismiss all / Purge all) lives in an overflow
//     (⋯) menu on both the strip and the SecurityPage SessionCard, the
//     SessionCard variant separated from navigation items by a divider.
//   * REGRESSION: dismissing findings now emits a findings-changed event
//     from the IPC layer, so the meta-row RiskPill refreshes. Pre-fix the
//     pill stayed stuck on the pre-dismiss count because DISMISS_FINDING
//     never published EVT_FINDINGS_CHANGED.
//
// Fixture: the same fake AWS key in two separate messages (→ two api-key
// findings sharing one value → ×2 after dedupe) plus one email (low).
// Assertions are locale-independent (counts, ordering, the literal ×2)
// since the e2e harness doesn't pin a UI language.

const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'
const SID = 'findings-actions-session'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      writeFileSync(join(claudeDir, 'test-project', 'findings-actions.jsonl'), [
        JSON.stringify({ type: 'user', sessionId: SID, cwd: '/tmp/test-project', uuid: 'fa-1', timestamp: '2026-05-21T10:00:00Z', message: { role: 'user', content: `rotate ${FAKE_AKIA} please` } }),
        JSON.stringify({ type: 'assistant', uuid: 'fa-2', timestamp: '2026-05-21T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' } }),
        JSON.stringify({ type: 'user', sessionId: SID, cwd: '/tmp/test-project', uuid: 'fa-3', timestamp: '2026-05-21T10:00:10Z', message: { role: 'user', content: `again, the key ${FAKE_AKIA} and email dev@fly.io` } }),
        JSON.stringify({ type: 'assistant', uuid: 'fa-4', timestamp: '2026-05-21T10:00:15Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'done' } }),
      ].join('\n'))
    },
  })
})

test.afterAll(async () => { await ctx?.cleanup() })

async function waitForWorkerIdle(window: Page): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<{ queued: number; scanning: number | null; backfillRemaining: number }> } } }).spool
    if (!api?.security) return false
    const s = await api.security.getScanStatus()
    return s.queued === 0 && s.scanning === null && s.backfillRemaining === 0
  }, { timeout: 30_000, polling: 250 })
}

async function openStrip(window: Page): Promise<void> {
  await window.locator('[data-testid="sidebar-library"]').click()
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator(`[data-testid="session-row"][data-session-uuid="${SID}"]`).first().click()
  const riskPill = window.locator('[data-testid="session-risk-pill"]').first()
  await expect(riskPill).toBeVisible({ timeout: 10_000 })
  if ((await riskPill.getAttribute('data-open')) !== '1') await riskPill.click()
  await expect(window.locator('[data-testid="findings-strip"]')).toBeVisible()
}

test('strip dedupes repeated values with ×N and exposes per-row + bulk actions', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)
  await openStrip(window)

  // Two api-key occurrences share one value → a single deduped row with
  // ×2; the email is its own row. Three findings, two visible rows.
  const apiRow = window.locator('[data-testid="strip-finding"][data-kind="api-key"]')
  await expect(apiRow).toHaveCount(1)
  await expect(apiRow.getByText('×2')).toBeVisible()
  await expect(window.locator('[data-testid="strip-finding"][data-kind="email"]')).toHaveCount(1)

  // Per-row actions exist (opacity-0 until hover, but present + clickable
  // — Playwright visibility ignores opacity). Dismiss opens a scope menu
  // with exactly the session + global choices.
  await expect(apiRow.locator('[data-testid="strip-ignore"]')).toBeVisible()
  await expect(apiRow.locator('[data-testid="strip-purge"]')).toBeVisible()
  await apiRow.locator('[data-testid="strip-ignore"]').click()
  await expect(window.locator('[role="menu"] [role="menuitem"]')).toHaveCount(2)
  await window.keyboard.press('Escape')

  // Header bulk menu carries exactly two actions: Dismiss all + Purge all.
  await window.locator('[data-testid="strip-bulk-menu"] button[aria-haspopup="menu"]').click()
  await expect(window.locator('[role="menu"] [role="menuitem"]')).toHaveCount(2)
  await window.keyboard.press('Escape')
})

test('SecurityPage SessionCard ⋯ menu carries bulk actions above a divider', async () => {
  const { window } = ctx
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()
  await window.locator('[data-testid="security-toggle-high"]').click()
  const apiKeyTile = window.locator('[data-testid="risk-category-chip"][data-kind="api-key"]')
  await expect(apiKeyTile).toBeVisible({ timeout: 10_000 })
  await apiKeyTile.click()

  await window.locator('[data-testid="security-session-menu"]').first().click()
  const menu = window.locator('[role="menu"]')
  // The divider only renders when the bulk block is prepended, so its
  // presence proves Dismiss all / Purge all were added at the top.
  await expect(menu.locator('[role="separator"]')).toHaveCount(1)
  // Bulk (2) + navigation items (≥4) all present.
  expect(await menu.locator('[role="menuitem"]').count()).toBeGreaterThanOrEqual(6)
  await window.keyboard.press('Escape')
})

test('REGRESSION: Dismiss all clears the strip and refreshes the meta-row pill', async () => {
  const { window } = ctx
  await openStrip(window)

  const riskPill = window.locator('[data-testid="session-risk-pill"]').first()
  await expect(riskPill).toBeVisible()

  // Bulk-dismiss everything — Dismiss all is the first item in the menu.
  await window.locator('[data-testid="strip-bulk-menu"] button[aria-haspopup="menu"]').click()
  await window.locator('[role="menu"] [role="menuitem"]').first().click()

  // Strip flips to its cleared state…
  await expect(window.locator('[data-testid="findings-strip"]')).toHaveAttribute('data-cleared', '1', { timeout: 10_000 })
  // …and the pill must disappear (0 active, 0 purged). Pre-fix it stayed
  // visible with the stale count because no findings-changed event fired.
  await expect(riskPill).toBeHidden({ timeout: 10_000 })
})

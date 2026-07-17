import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression for the "Risk icon on session rows" toggle added in
// Settings → Security (PR introducing `sessionRowRiskIconVisible`).
//
// Pre-pref: every Library / Project view row with a high-severity
// finding rendered the inline AlertTriangle, with no opt-out.
//
// Post-pref:
//   * Settings → Security exposes a per-user toggle that hides the
//     entire row-level SecurityBadge (high/low triangle + the
//     "resolved ✓" variant) on Sessions and Project view.
//   * The dedicated Security page is NOT gated by this pref — its
//     AlertTriangle usages live on the SecurityPage component, not
//     SessionRow, so they remain regardless of the toggle.
//
// We seed one fake AWS access-key so the SessionRow gets a real
// high-severity badge to assert on.

// Fake AWS access-key — see security-badge.spec.ts for the obfuscation
// rationale (avoid GitHub push-protection + our vendor-example filter).
const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      const file = join(claudeDir, 'test-project', 'row-risk-icon-fixture.jsonl')
      writeFileSync(file, [
        JSON.stringify({
          type: 'user',
          sessionId: 'row-risk-icon-session',
          cwd: '/tmp/test-project',
          uuid: 'rri-msg-1',
          timestamp: '2026-05-28T10:00:00Z',
          message: { role: 'user', content: `please rotate ${FAKE_AKIA}` },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'rri-msg-2',
          timestamp: '2026-05-28T10:00:05Z',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4',
            content: 'rotated',
          },
        }),
      ].join('\n'))
    },
  })
})

test.afterAll(async () => { await ctx?.cleanup() })

async function waitForWorkerIdle(window: AppContext['window']): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<{ queued: number; scanning: number | null; backfillRemaining: number }> } } }).spool
    if (!api?.security) return false
    const s = await api.security.getScanStatus()
    return s.queued === 0 && s.scanning === null && s.backfillRemaining === 0
  }, { timeout: 30_000, polling: 250 })
}

test('Settings toggle hides the row-level risk badge on Project view, Security page is unaffected', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  // Baseline: navigate into the project, the row badge is visible.
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const row = window
    .locator('[data-testid="session-row"][data-session-uuid="row-risk-icon-session"]')
    .first()
  await expect(row).toBeVisible({ timeout: 5_000 })
  const badge = row.locator('[data-testid="security-badge"][data-severity="high"]')
  await expect(badge).toBeVisible({ timeout: 5_000 })

  // Flip the new toggle in Settings → Security.
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  const toggle = window.locator('[data-testid="settings-row-risk-icon"]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  // Close Settings and re-enter the project — the row badge must be gone.
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
  await expect(row).toBeVisible({ timeout: 5_000 })
  await expect(row.locator('[data-testid="security-badge"]')).toHaveCount(0)

  // SecurityPage is intentionally NOT gated by this pref. Its session
  // strip lives in a separate component tree and keeps rendering
  // findings. We only assert the page mounts cleanly with the toggle
  // off — finer-grained Security-page assertions live in other specs.
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // Flip the toggle back on; the row badge reappears.
  await window.locator('[data-testid="sidebar-library"]').click()
  await window.locator('[data-testid="settings-button"]').click()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await window.keyboard.press('Escape')

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await expect(row.locator('[data-testid="security-badge"][data-severity="high"]')).toBeVisible({ timeout: 5_000 })
})

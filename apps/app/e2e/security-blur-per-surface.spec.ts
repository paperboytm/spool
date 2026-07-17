import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression for the per-surface blur prefs introduced 2026-05.
//
// Pre-fix: a single `revealValuesOnHoverOnly` flag existed on disk but
// was never read — the Settings toggle promised "blur values until you
// hover" while both surfaces kept rendering values in clear.
//
// Post-fix:
//   * `securityPageValuesBlurred` and `findingsStripValuesBlurred` are
//     independent persisted prefs.
//   * Each surface's Eye/EyeOff icon writes directly to its pref via
//     setPrefs (no ephemeral override).
//   * Toggling either pref or icon updates both: pref changes propagate
//     via onPrefsChanged, so Settings UI and surface icons mirror.
//
// We seed one fake AWS access-key + a couple of regex-detectable
// strings so both Security page rows and the session-detail strip
// have something to blur.

// Fake AWS access-key — see security-badge.spec.ts.
const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      const file = join(claudeDir, 'test-project', 'blur-fixture.jsonl')
      writeFileSync(file, [
        JSON.stringify({
          type: 'user',
          sessionId: 'blur-fixture-session',
          cwd: '/tmp/test-project',
          uuid: 'bf-msg-1',
          timestamp: '2026-05-21T10:00:00Z',
          message: { role: 'user', content: `please rotate ${FAKE_AKIA}` },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'bf-msg-2',
          timestamp: '2026-05-21T10:00:05Z',
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

test('Per-surface blur prefs are independent and bidirectional with the in-page icons', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  // Baseline: both prefs default false → values revealed everywhere.
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()
  // Expand the High severity section so finding rows render.
  await window.locator('[data-testid="security-toggle-high"]').click()
  // Click the api-key tile to filter, which surfaces the SessionCard
  // for the fixture session and its FindingItem rows.
  const apiKeyTile = window.locator('[data-testid="risk-category-chip"][data-kind="api-key"]')
  await expect(apiKeyTile).toBeVisible({ timeout: 10_000 })
  await apiKeyTile.click()

  const findingRow = window.locator('[data-testid="finding-row"][data-kind="api-key"]').first()
  await expect(findingRow).toBeVisible({ timeout: 10_000 })
  await expect(findingRow).toHaveAttribute('data-blurred', '0')

  // Flip the Security-page blur pref via the in-page Eye icon. The
  // page should re-render with the row blurred.
  await window.locator('[data-testid="security-toggle-values"]').click()
  await expect(findingRow).toHaveAttribute('data-blurred', '1')

  // Settings should now reflect the same state — the Settings toggle
  // and the page icon are two surfaces of one pref.
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  const pageToggle = window.locator('[data-testid="settings-blur-page"]')
  await expect(pageToggle).toBeVisible()
  await expect(pageToggle).toHaveAttribute('aria-checked', 'true')

  // The strip pref must still be independent — not flipped just because
  // the page pref was.
  const stripToggle = window.locator('[data-testid="settings-blur-strip"]')
  await expect(stripToggle).toHaveAttribute('aria-checked', 'false')

  // Flip the strip pref ON via Settings, leave the page pref ON.
  await stripToggle.click()
  await expect(stripToggle).toHaveAttribute('aria-checked', 'true')

  // Close Settings and verify the strip is blurred on the session
  // detail surface (independent surface, independent pref).
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()

  // Navigate into the fixture session — sidebar → library → project
  // → session row. SessionDetail mounts FindingsStrip closed; click
  // the RiskPill to open it.
  await window.locator('[data-testid="sidebar-library"]').click()
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const sessionRow = window
    .locator('[data-testid="session-row"][data-session-uuid="blur-fixture-session"]')
    .first()
  await sessionRow.click()
  // Risk pill opens the strip — its testid is `session-risk-pill`.
  const riskPill = window.locator('[data-testid="session-risk-pill"]').first()
  await expect(riskPill).toBeVisible({ timeout: 10_000 })
  await riskPill.click()

  const stripFinding = window.locator('[data-testid="strip-finding"][data-kind="api-key"]').first()
  await expect(stripFinding).toBeVisible({ timeout: 10_000 })
  await expect(stripFinding).toHaveAttribute('data-blurred', '1')

  // Click the strip's own Eye icon to flip it back to revealed.
  // The pref write goes through setPrefs → propagates via onPrefsChanged
  // → the row's data-blurred attribute updates.
  await window.locator('[data-testid="strip-toggle-values"]').click()
  await expect(stripFinding).toHaveAttribute('data-blurred', '0')
})

import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Fake AWS access-key fixture — see security-badge.spec.ts.
const FAKE_AKIA = 'AKIA' + 'V3QFKW72ZDLNP4XR'

// Regression test for the muted-kind UI refresh chain (May 2026):
//   click chip in Settings → SET_PREFS handler → worker.backfill()
//   → scan publishes 'session-rescanned' to PubSub → forwarder
//   fiber sends EVT_FINDINGS_CHANGED → SecurityPage onChange refetches
//   → meta row updates without a manual refresh.
//
// The exact failure mode this gates against: `Effect.runPromise(
// Effect.fork(...))` interrupts the forwarder fiber immediately, so
// events never reach the renderer and the page stays stale.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // One session with a single high-severity api-key. The mute
      // target is `api-key` so visibleActive should drop 1 → 0.
      const file = join(claudeDir, 'test-project', 'test-session-mute-refresh.jsonl')
      writeFileSync(file, [
        JSON.stringify({
          type: 'user',
          sessionId: 'mute-refresh-fixture',
          cwd: '/tmp/test-project',
          uuid: 'mr-msg-1',
          timestamp: '2026-05-20T10:00:00Z',
          message: {
            role: 'user',
            content: `leaked ${FAKE_AKIA} to a log, rotate it`,
          },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'mr-msg-2',
          timestamp: '2026-05-20T10:00:05Z',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4',
            content: 'rotating now',
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

async function openSecurityTab(window: AppContext['window']) {
  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await window
    .locator('[data-testid="settings-panel"] [aria-pressed]')
    .filter({ hasText: /Security|安全|セキュリティ|보안|Sécurité|Sicherheit/ })
    .click()
  await expect(window.locator('[data-testid="settings-rescan-all"]')).toBeVisible({ timeout: 10_000 })
}

test('Muting a kind from Settings refreshes the Security page automatically', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  // Navigate to Security page. The meta row says "{{findings}} risk
  // · {{sessions}} sessions"; we read the live count via the IPC
  // since the rendered text varies (locale + plural).
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  async function activeApiKey(): Promise<number> {
    return await window.evaluate(async () => {
      const api = (globalThis as { spool?: { security?: { riskByCategory: () => Promise<Array<{ kind: string; count: number }>> } } }).spool
      const rows = await api!.security!.riskByCategory()
      return rows.find((r) => r.kind === 'api-key')?.count ?? 0
    })
  }

  // Baseline — the fixture session has exactly one api-key.
  expect(await activeApiKey()).toBeGreaterThanOrEqual(1)

  // Mute api-key via Settings → Security → Mute by kind.
  await openSecurityTab(window)
  await window.locator('[data-testid="settings-muted-kinds-toggle"]').click()
  const chip = window.locator('[data-testid="settings-muted-kind-chip"][data-kind="api-key"]')
  await expect(chip).toHaveAttribute('data-muted', 'false')
  await chip.click()
  await expect(chip).toHaveAttribute('data-muted', 'true')

  // Dismiss Settings and return to the Security page WITHOUT
  // touching Rescan, refresh, or any other action. The page must
  // update purely from the worker→renderer event bridge.
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // The chain that has to fire on its own:
  //   SET_PREFS → backfill → drain fiber rescans the fixture session
  //   → publishes 'session-rescanned' → forwarder fiber sends
  //   EVT_FINDINGS_CHANGED → SecurityPage onChange → refresh.
  //
  // If the forwarder fiber is dead (the bug this test gates against),
  // active api-key stays > 0 forever and this poll times out.
  await expect.poll(activeApiKey, { timeout: 15_000, intervals: [250] }).toBe(0)

  // Cleanup: unmute so subsequent tests start clean.
  await openSecurityTab(window)
  await window.locator('[data-testid="settings-muted-kinds-toggle"]').click()
  await window.locator('[data-testid="settings-muted-kind-chip"][data-kind="api-key"]').click()
})

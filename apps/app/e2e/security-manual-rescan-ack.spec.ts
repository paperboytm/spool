import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Per-iter AKIA-shaped fixtures (5 sessions, 5 distinct keys). Each
// is exactly `AKIA + 16 [A-Z0-9]` so the regex matches and the new
// validator (drops `*EXAMPLE` suffix) doesn't.
const akiaForIter = (i: number) =>
  'AKIA' + 'V3QFKW72ZDLNP4'.padEnd(14, 'X') + i.toString().padStart(2, '0')

// Regression test for the manual-rescan ACK banner race (May 2026):
//
// Click `Rescan all` → worker.rescanAll() runs in the thread →
// busy→idle status push → renderer's `ScanResultBanner` ("Scan
// complete · N high · M low") must appear and stick until the user
// dismisses it with the × button.
//
// Failure mode the test gates against: the renderer used to flag
// "this is a manual scan" via a click-local ref. An auto sync-driven
// enqueue completing between the click and the IPC reaching the
// worker would hijack the busy→idle edge, consume the flag, and the
// real manual scan would later finish with the renderer thinking it
// was an auto burst — banner never rendered, only a toast for any
// new-findings delta.
//
// Worker-side fix: `manualBurstInFlight` field on `ScanStatus`,
// set by `worker.rescanAll()` and cleared by the updateStatus
// wrapper on full idle. Renderer latches off the worker's truth, so
// IPC races can't fool the ACK detection.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Five sessions, each with a high-severity api-key. backfillTotal
      // ends up well above the ambient banner threshold (5), so the
      // scanning banner + result banner both render.
      for (let i = 0; i < 5; i++) {
        writeFileSync(
          join(claudeDir, 'test-project', `manual-rescan-fixture-${i}.jsonl`),
          [
            JSON.stringify({
              type: 'user',
              sessionId: `manual-rescan-${i}`,
              cwd: '/tmp/test-project',
              uuid: `mr-${i}-msg-1`,
              timestamp: `2026-05-20T10:00:0${i}Z`,
              message: {
                role: 'user',
                content: `leaked ${akiaForIter(i)} to a log, rotate it`,
              },
            }),
            JSON.stringify({
              type: 'assistant',
              uuid: `mr-${i}-msg-2`,
              timestamp: `2026-05-20T10:00:0${i}.5Z`,
              message: {
                role: 'assistant',
                model: 'claude-sonnet-4',
                content: 'rotating now',
              },
            }),
          ].join('\n'),
        )
      }
    },
  })
})

test.afterAll(async () => { await ctx?.cleanup() })

async function waitForWorkerIdle(window: AppContext['window']): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<{ queued: number; scanning: number | null; backfillRemaining: number; manualBurstInFlight: boolean }> } } }).spool
    if (!api?.security) return false
    const s = await api.security.getScanStatus()
    return s.queued === 0 && s.scanning === null && s.backfillRemaining === 0 && !s.manualBurstInFlight
  }, { timeout: 30_000, polling: 250 })
}

test('Rescan all surfaces a Scan-complete banner that survives a follow-up auto burst', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // Pre-condition: no result banner before the user clicks.
  await expect(window.locator('[data-testid="security-scan-result-banner"]')).toBeHidden()

  await window.locator('[data-testid="security-rescan-all"]').click()
  await waitForWorkerIdle(window)

  // Result banner must show — this is the regression site. Generous
  // timeout because the manual ACK needs the busy→idle event to land
  // and the React state to flush.
  await expect(
    window.locator('[data-testid="security-scan-result-banner"]'),
  ).toBeVisible({ timeout: 10_000 })

  // The reported scanned count matches the worker's reported high-water
  // mark — at LEAST the fixture count (the boot backfill might have
  // pulled others in). Reading via data attribute keeps the assert
  // locale-agnostic.
  const scanned = await window
    .locator('[data-testid="security-scan-result-banner"]')
    .getAttribute('data-scanned')
  expect(Number(scanned)).toBeGreaterThanOrEqual(5)

  // The banner must NOT disappear when an auto burst kicks in
  // afterwards. We simulate one by directly invoking
  // `securityApi.rescanSession` (which calls worker.enqueue) from
  // the renderer — same path syncer-driven file mtime ticks would
  // take on a live archive. Before the fix, this would silently
  // clear `scanResult` via the renderer's idle→busy edge handler.
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: { rescanSession: (id: number) => Promise<unknown> } } }).spool
    await api!.security!.rescanSession(1)
  })

  // Give the worker time to drain the 1-session auto burst.
  await window.waitForTimeout(2000)
  await waitForWorkerIdle(window)

  // Banner stays — the auto burst's busy→idle does not consume the
  // manual ACK.
  await expect(
    window.locator('[data-testid="security-scan-result-banner"]'),
  ).toBeVisible()

  // The × dismisses it (and only the ×).
  await window.locator('[data-testid="security-scan-result-dismiss"]').click()
  await expect(
    window.locator('[data-testid="security-scan-result-banner"]'),
  ).toBeHidden()
})

// Companion test for the opposite half of the contract: a purely
// background scan (no Rescan-all click) must NEVER surface the
// "Scan complete" ACK banner. Boot backfill, syncer-driven
// rescans, settings-toggle-driven backfills all share this path.
// Discovery feedback for net-new high-risk findings lives in the
// sonner toast, not in the persistent banner — banners are for
// "you clicked something, here's the receipt", not "the engine
// did its job".
test('A purely background scan never surfaces the Scan-complete banner', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // Dismiss any banner the prior test left behind so this case
  // starts from a clean state. The previous test's `×` click
  // already cleared it, but be defensive.
  const banner = window.locator('[data-testid="security-scan-result-banner"]')
  await expect(banner).toBeHidden()

  // Trigger a background scan via `rescanSession` (same path the
  // Syncer uses for sync-driven enqueues) — bypasses the click
  // handler entirely.
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: { rescanSession: (id: number) => Promise<unknown> } } }).spool
    await api!.security!.rescanSession(1)
  })

  await waitForWorkerIdle(window)

  // Wait a beat longer than the trailing 1500ms idle gate so any
  // delayed banner pop has had its chance to render. None should.
  await window.waitForTimeout(2500)

  await expect(banner).toBeHidden()
})

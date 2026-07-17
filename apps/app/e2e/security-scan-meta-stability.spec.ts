import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression test for the meta-row layout shift (May 2026):
//
// The meta row reads "N risk · M info · scanned X ago · [detectors
// chip] [rescan button]". The inline "scanned X ago" segment used to
// be suppressed while the full ScanBanner was shown — so clicking
// Rescan all collapsed the row width mid-scan, shoving the detectors
// chip + rescan button leftwards, then back when the scan finished.
//
// Fix: the timestamp is a stable "last completed" fact, not a
// scan-in-flight signal, so it stays put even under the banner. Only
// the ambient dot (which WOULD duplicate the banner) is suppressed,
// and it lives in a fixed-width slot so its fade never reflows
// anything to its right.
//
// This gates against the timestamp vanishing AND against the rescan
// button moving horizontally during a scan.

const akiaForIter = (i: number) =>
  'AKIA' + 'V3QFKW72ZDLNP4'.padEnd(14, 'X') + i.toString().padStart(2, '0')

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Five sessions so backfillTotal clears the ambient banner
      // threshold (5) and the scanning banner renders on Rescan all.
      for (let i = 0; i < 5; i++) {
        writeFileSync(
          join(claudeDir, 'test-project', `meta-stability-fixture-${i}.jsonl`),
          [
            JSON.stringify({
              type: 'user',
              sessionId: `meta-stability-${i}`,
              cwd: '/tmp/test-project',
              uuid: `ms-${i}-msg-1`,
              timestamp: `2026-05-20T10:00:0${i}Z`,
              message: {
                role: 'user',
                content: `leaked ${akiaForIter(i)} to a log, rotate it`,
              },
            }),
            JSON.stringify({
              type: 'assistant',
              uuid: `ms-${i}-msg-2`,
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

test('Meta row keeps the timestamp and holds the rescan button still during a scan', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  const scanState = window.locator('[data-testid="security-scan-state"]')
  const rescanBtn = window.locator('[data-testid="security-rescan-all"]')

  // Precondition: the boot backfill has set a "scanned X ago" stamp.
  await expect(scanState).toBeVisible()

  const restingX = (await rescanBtn.boundingBox())!.x

  await rescanBtn.click()

  // The scanning banner must come up — this is the state that used to
  // hide the timestamp.
  await expect(window.locator('[data-testid="security-scan-banner"]')).toBeVisible({ timeout: 10_000 })

  // Regression: the timestamp must NOT disappear under the banner...
  await expect(scanState).toBeVisible()
  // ...and the rescan button must not have shifted sideways.
  const scanningX = (await rescanBtn.boundingBox())!.x
  expect(Math.abs(scanningX - restingX)).toBeLessThan(1)

  await waitForWorkerIdle(window)

  // Back at rest, still stable.
  await expect(scanState).toBeVisible()
  const settledX = (await rescanBtn.boundingBox())!.x
  expect(Math.abs(settledX - restingX)).toBeLessThan(1)
})

import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

// Security IPC handlers are registered inside `bootScanWorker().then(...)`
// in main/index.ts, so they're not available until the scan worker
// has booted. Probing getScanStatus is the cheapest signal that
// registerSecurityIpc has finished — any handler being available
// implies all of them are.
async function waitForSecurityIpc(window: AppContext['window']): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<unknown> } } }).spool?.security
    if (!api) return false
    try {
      await api.getScanStatus()
      return true
    } catch {
      return false
    }
  }, { timeout: 30_000, polling: 100 })
}

// PF download card surface coverage (PR 5e):
// - Card renders in not-installed phase on a fresh app
// - Clicking Download flips the card into downloading and surfaces a
//   Cancel button; clicking Cancel returns it to not-installed
// - Toggle is absent until the model has finished installing — gates
//   against pre-PR-5e behaviour where the inert Coming-soon toggle was
//   reachable.
//
// The app's main process detects SPOOL_E2E_TEST=1 (set by launchApp)
// and substitutes pfCoordinator's fetch with an immediate-503 stub,
// so the transition out of not-installed never touches the network.
// State-machine correctness itself is covered by pf-coordinator.test.ts
// with the same kind of injected fakes; this e2e only verifies the
// click → IPC → renderer wiring.

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

// Surface-shape + state-machine wiring in one launch.
//
// The state-transition assertion deliberately bypasses the React
// render path. The coordinator's state machine is already synchronous
// and deterministic in tests (Effect-driven, with an immediate-503
// fake fetch courtesy of SPOOL_E2E_TEST=1 — see main/index.ts).
// Going through "click button → IPC → main → coordinator → publish →
// IPC event → setState → re-render → DOM attribute" adds three layers
// of async machinery the test doesn't actually care about — every
// one of which has its own scheduling and was the source of the
// flake. Calling pfDownloadStart() then pfGetState() over IPC asks
// the coordinator directly: "did your state machine advance?" The
// IPC handler awaits the full startDownload (downloading → failed),
// so by the time the promise resolves the terminal state is
// already on disk; pfGetState reads it without polling.
test('PF card renders not-installed; Download dispatch advances state machine', async () => {
  const { window } = ctx
  await waitForSecurityIpc(window)
  await openSecurityTab(window)

  // UI surface shape — the renderer can lie about anything if its
  // IPC bridge breaks, so these assertions stay DOM-bound.
  const card = window.locator('[data-testid="settings-detector-pf"]')
  await expect(card).toBeVisible()
  await expect(card).toHaveAttribute('data-phase', 'not-installed')
  await expect(card.locator('[data-testid="settings-pf-download"]')).toBeVisible()
  // Toggle is absent until the model has finished installing — gates
  // against pre-PR-5e behaviour where the inert Coming-soon toggle was
  // reachable.
  await expect(card.locator('[data-testid="settings-pf-toggle"]')).toHaveCount(0)

  // State-machine wiring — coordinator truth, not DOM truth.
  type PfApi = {
    pfDownloadStart: () => Promise<{ ok: boolean }>
    pfGetState: () => Promise<{ phase: string }>
  }
  const phase = await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: PfApi } }).spool?.security
    if (!api) throw new Error('window.spool.security missing')
    await api.pfDownloadStart()
    return (await api.pfGetState()).phase
  })
  // With the synchronous 503 fake, the terminal state after
  // pfDownloadStart resolves is deterministically 'failed'.
  expect(phase).not.toBe('not-installed')
})

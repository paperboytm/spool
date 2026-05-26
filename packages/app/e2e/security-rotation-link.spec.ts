import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Layer 1 — one-click rotate deep-links.
//
// A credential finding whose value resolves to a known vendor surfaces
// a "Rotate at <vendor> ↗" link inside the PurgeConfirmDialog, pointing
// at the vendor's official key-management page. PII findings (email)
// that can't be rotated must NOT show the link.
//
// Fixture: a fake GitHub PAT (ghp_…, → vendor GitHub) and a plain email.

const FAKE_GHP = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const SID = 'rotation-link-session'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      writeFileSync(join(claudeDir, 'test-project', 'rotation-link.jsonl'), [
        JSON.stringify({ type: 'user', sessionId: SID, cwd: '/tmp/test-project', uuid: 'rl-1', timestamp: '2026-05-21T10:00:00Z', message: { role: 'user', content: `my token is ${FAKE_GHP} and email dev@fly.io` } }),
        JSON.stringify({ type: 'assistant', uuid: 'rl-2', timestamp: '2026-05-21T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' } }),
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

// Worker-idle alone can be a FALSE idle: status can read queued=0 in the
// window between sync finishing and the new session's scan being
// enqueued, so the finding (and its risk pill) isn't there yet and
// openStrip's pill wait times out on a cold launch. Wait until findings
// have actually been produced before driving the UI.
async function waitForFindings(window: Page): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { riskByCategory: () => Promise<unknown[]> } } }).spool
    if (!api?.security) return false
    const cats = await api.security.riskByCategory()
    return Array.isArray(cats) && cats.length > 0
  }, { timeout: 30_000, polling: 250 })
}

async function openStrip(window: Page): Promise<void> {
  await window.locator('[data-testid="sidebar-library"]').click()
  // The fixture session lives under the "test-project" Claude project,
  // not the alphabetically-first row, so target it explicitly.
  await window.locator('[data-testid="sidebar-project-row"]', { hasText: 'test-project' }).first().click()
  await window.locator(`[data-testid="session-row"][data-session-uuid="${SID}"]`).first().click()
  const riskPill = window.locator('[data-testid="session-risk-pill"]').first()
  await expect(riskPill).toBeVisible({ timeout: 10_000 })
  if ((await riskPill.getAttribute('data-open')) !== '1') await riskPill.click()
  await expect(window.locator('[data-testid="findings-strip"]')).toBeVisible()
}

test('credential finding offers a vendor-specific rotate link; PII does not', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)
  await waitForFindings(window)
  await openStrip(window)

  // Open the purge dialog on the api-key (GitHub) row.
  const apiRow = window.locator('[data-testid="strip-finding"][data-kind="api-key"]')
  await expect(apiRow).toHaveCount(1)
  await apiRow.locator('[data-testid="strip-purge"]').click()

  const dialog = window.locator('[data-testid="purge-confirm"]')
  await expect(dialog).toBeVisible()
  const rotate = dialog.locator('[data-testid="rotate-link"]')
  await expect(rotate).toBeVisible()
  await expect(rotate).toHaveAttribute('data-vendor', 'GitHub')
  await expect(rotate).toHaveAttribute('href', 'https://github.com/settings/tokens')
  await window.keyboard.press('Escape')

  // The email row is PII — its purge dialog must not show a rotate link.
  const emailRow = window.locator('[data-testid="strip-finding"][data-kind="email"]')
  await expect(emailRow).toHaveCount(1)
  await emailRow.locator('[data-testid="strip-purge"]').click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('[data-testid="rotate-link"]')).toHaveCount(0)
  await window.keyboard.press('Escape')
})

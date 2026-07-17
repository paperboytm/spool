import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Layer 2 — cross-session blast radius.
//
// The same fake AWS key leaks in TWO different sessions. On the
// SecurityPage credential finding row, a "Appears in N sessions across
// M projects" affordance expands to the per-session list. A PII (email)
// finding shows no blast radius (identity recurrence is expected).

const FAKE_AKIA = 'AKIA' + 'B7QFKW72ZDLNP4XZ'
const SID_A = 'blast-session-a'
const SID_B = 'blast-session-b'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      writeFileSync(join(claudeDir, 'test-project', 'blast-a.jsonl'), [
        JSON.stringify({ type: 'user', sessionId: SID_A, cwd: '/tmp/test-project', uuid: 'ba-1', timestamp: '2026-05-21T10:00:00Z', message: { role: 'user', content: `key ${FAKE_AKIA} and email me@x.io` } }),
        JSON.stringify({ type: 'assistant', uuid: 'ba-2', timestamp: '2026-05-21T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' } }),
      ].join('\n'))
      writeFileSync(join(claudeDir, 'test-project', 'blast-b.jsonl'), [
        JSON.stringify({ type: 'user', sessionId: SID_B, cwd: '/tmp/test-project', uuid: 'bb-1', timestamp: '2026-05-22T10:00:00Z', message: { role: 'user', content: `same key ${FAKE_AKIA} again` } }),
        JSON.stringify({ type: 'assistant', uuid: 'bb-2', timestamp: '2026-05-22T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' } }),
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

// Worker-idle can be a FALSE idle (queued=0 in the window before the new
// session's scan is enqueued), so findings/risk categories aren't there
// yet. Wait until they've actually been produced before driving the UI.
async function waitForFindings(window: Page): Promise<void> {
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { riskByCategory: () => Promise<unknown[]> } } }).spool
    if (!api?.security) return false
    const cats = await api.security.riskByCategory()
    return Array.isArray(cats) && cats.length > 0
  }, { timeout: 30_000, polling: 250 })
}

test('credential finding shows cross-session blast radius; PII does not', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)
  await waitForFindings(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()
  await window.locator('[data-testid="security-toggle-high"]').click()

  // Open the api-key category to list its findings.
  const apiKeyTile = window.locator('[data-testid="risk-category-chip"][data-kind="api-key"]')
  await expect(apiKeyTile).toBeVisible({ timeout: 10_000 })
  await apiKeyTile.click()

  // The api-key value row carries a quiet ⧉N badge. The same key leaks
  // in 2 sessions; the count is framed around the OTHER session (the
  // finding's own is excluded), so the badge reports 1.
  const apiRow = window.locator('[data-testid="finding-row-wrap"]').filter({
    has: window.locator('[data-testid="finding-row"][data-kind="api-key"]'),
  }).first()
  const badge = apiRow.locator('[data-testid="blast-badge"]')
  await expect(badge).toBeVisible({ timeout: 10_000 })
  await expect(badge).toHaveAttribute('data-sessions', '1')

  // Clicking the badge expands the per-session list — the one OTHER
  // session, tagged with its source dot so it reads as a session.
  await badge.click()
  const radius = apiRow.locator('[data-testid="blast-radius"]')
  await expect(radius.locator('[data-testid="blast-radius-row"]')).toHaveCount(1)
  await expect(radius.locator('[data-testid="blast-radius-row"] [data-testid="source-dot"]')).toHaveCount(1)
})

test('purge everywhere scrubs every copy and collapses the radius', async () => {
  const { window } = ctx
  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  const apiRow = window.locator('[data-testid="finding-row-wrap"]').filter({
    has: window.locator('[data-testid="finding-row"][data-kind="api-key"]'),
  }).first()
  const badge = apiRow.locator('[data-testid="blast-badge"]')
  await expect(badge).toBeVisible({ timeout: 10_000 })
  // Expand idempotently — the badge's `expanded` state may already be
  // true from the previous test (same page, no remount). Toggle only if
  // collapsed, then wait for the list.
  if ((await badge.getAttribute('aria-expanded')) !== 'true') await badge.click()
  const radius = apiRow.locator('[data-testid="blast-radius"]')
  await expect(radius.locator('[data-testid="blast-radius-list"]')).toBeVisible()

  // The "Purge everywhere" CTA opens the bulk confirm dialog.
  await radius.locator('[data-testid="purge-everywhere"]').click()
  const dialog = window.locator('[data-testid="purge-confirm"]')
  await expect(dialog).toBeVisible()
  await dialog.locator('[data-testid="purge-confirm-button"]').click()

  // After purge: every copy is masked across both sessions → otherCount
  // drops to 0 → the ⧉N badge disappears from every api-key row. This is
  // the UI proof that purge-everywhere reached every copy. FTS re-sync is
  // asserted deterministically in the core purge unit test
  // (purge.test.ts → 'keeps messages_fts in sync').
  await expect(window.locator('[data-testid="blast-badge"]')).toHaveCount(0, { timeout: 10_000 })
})

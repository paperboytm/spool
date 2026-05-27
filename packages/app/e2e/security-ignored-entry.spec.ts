import { test, expect, type Page } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// The "Ignored items" review used to be reachable only via Settings →
// Security → Ignored items → Review (three levels deep). This spec
// gates the shallow entry surfaced on the main Security page:
//
//   * hidden while nothing is ignored (count 0 → no entry),
//   * appears once a finding is dismissed (count > 0),
//   * clicking it opens the same AllowlistManageModal
//     ([data-testid="ignored-manage"]).
//
// The count flows through the page's findings-changed refresh path —
// dismissing a finding writes an allowlist row, so the badge moves
// without a manual refresh.

const FAKE_AKIA = 'AKIA' + 'IGNOREDENTRY00X1'
const SID = 'ignored-entry-session'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      writeFileSync(join(claudeDir, 'test-project', 'ignored-entry.jsonl'), [
        JSON.stringify({ type: 'user', sessionId: SID, cwd: '/tmp/test-project', uuid: 'ie-1', timestamp: '2026-05-21T10:00:00Z', message: { role: 'user', content: `leaked ${FAKE_AKIA}, rotate it` } }),
        JSON.stringify({ type: 'assistant', uuid: 'ie-2', timestamp: '2026-05-21T10:00:05Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'ok' } }),
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

test('Security page surfaces an Ignored entry that opens the manage modal', async () => {
  const { window } = ctx
  await waitForSync(window)
  await waitForWorkerIdle(window)

  await window.locator('[data-testid="sidebar-security"]').click()
  await expect(window.locator('[data-testid="security-page"]')).toBeVisible()

  // Nothing ignored yet — the entry stays hidden.
  await expect(window.locator('[data-testid="security-ignored-open"]')).toHaveCount(0)

  // Dismiss the fixture's api-key finding (writes an allowlist row).
  await window.evaluate(async () => {
    const api = (globalThis as { spool?: { security?: {
      listFindings: (f: unknown) => Promise<Array<{ id: number; kind: string }>>
      dismissFinding: (id: number, scope: string) => Promise<unknown>
    } } }).spool
    const rows = await api!.security!.listFindings({ state: 'active' })
    const target = rows.find((r) => r.kind === 'api-key') ?? rows[0]
    if (target) await api!.security!.dismissFinding(target.id, 'global')
  })

  // The entry appears off the findings-changed refresh path, no manual
  // rescan needed.
  const entry = window.locator('[data-testid="security-ignored-open"]')
  await expect(entry).toBeVisible({ timeout: 15_000 })
  // Icon-only button — the label lives in the tooltip / aria-label.
  await expect(entry).toHaveAttribute('aria-label', /Ignored/)

  // Clicking opens the shared manage modal.
  await entry.click()
  await expect(window.locator('[data-testid="ignored-manage"]')).toBeVisible({ timeout: 10_000 })
})

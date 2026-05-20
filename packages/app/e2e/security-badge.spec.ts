import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Drop a synthetic Claude session containing a fake AWS key in
      // user content. The regex provider matches `AKIA[0-9A-Z]{16}`
      // and classifies it as `api-key` (high-severity).
      const sessionFile = join(claudeDir, 'test-project', 'test-session-security.jsonl')
      writeFileSync(sessionFile, [
        JSON.stringify({
          type: 'user',
          sessionId: 'security-fixture-session',
          cwd: '/tmp/test-project',
          uuid: 'sec-msg-1',
          timestamp: '2026-05-19T10:00:00Z',
          message: {
            role: 'user',
            content: 'I leaked AKIAIOSFODNN7EXAMPLE to a log, please rotate it.',
          },
        }),
        JSON.stringify({
          type: 'assistant',
          uuid: 'sec-msg-2',
          timestamp: '2026-05-19T10:00:05Z',
          message: {
            role: 'assistant',
            model: 'claude-sonnet-4',
            content: 'Rotating that AWS key now.',
          },
        }),
      ].join('\n'))
    },
  })
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('Library row shows a high-severity Security Scan badge for a session with a credential leak', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Navigate into the project so the seeded session is visible.
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const target = window.locator(
    '[data-testid="session-row"][data-session-uuid="security-fixture-session"]',
  )
  await expect(target).toBeVisible({ timeout: 5000 })

  // Wait for the scan worker to fully drain — backfill runs async
  // after sync, so we poll status until idle, then expect the badge.
  await window.waitForFunction(async () => {
    const api = (globalThis as { spool?: { security?: { getScanStatus: () => Promise<{ queued: number; scanning: number | null; backfillRemaining: number }> } } }).spool
    if (!api?.security) return false
    const s = await api.security.getScanStatus()
    return s.queued === 0 && s.scanning === null && s.backfillRemaining === 0
  }, { timeout: 30_000, polling: 250 })

  // The polling fallback in ProjectView refetches every 750ms while
  // the worker is busy, so by now the badge should be in the DOM.
  // `.first()` tolerates Library renders where the session shows up
  // in multiple lists (e.g. pinned slot + active list) so the
  // strict-mode locator doesn't fail on the duplicate.
  const badge = target.locator('[data-testid="security-badge"][data-severity="high"]').first()
  await expect(badge).toBeVisible({ timeout: 5_000 })
})

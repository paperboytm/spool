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
  const row = window.locator('[data-testid="session-row"]').filter({
    has: window.locator('text=AKIAIOSFODNN7EXAMPLE'),
  }).first()
  // The above filter relies on title being non-empty; fall back to
  // session_uuid match if the project view doesn't surface the AWS
  // text in the row preview.
  const fallback = window.locator(
    '[data-testid="session-row"][data-session-uuid="security-fixture-session"]',
  )
  const target = (await fallback.count()) > 0 ? fallback : row
  await expect(target).toBeVisible({ timeout: 5000 })

  // Wait for the scan worker to finish — backfill runs asynchronously
  // after sync, so the badge may appear a few hundred ms later.
  const badge = target.locator('[data-testid="security-badge"][data-severity="high"]')
  await expect(badge).toBeVisible({ timeout: 10_000 })
})

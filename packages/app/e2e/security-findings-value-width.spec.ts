import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Regression test for the finding-row value over-truncation (May 2026):
//
// The hover actions (Dismiss / Everywhere / Purge) used to live in an
// `auto` grid column rendered with `opacity-0 group-hover:opacity-100`.
// opacity toggles visibility but NOT layout, so the column reserved the
// full ~200px button-cluster width on every row even while the buttons
// were invisible — the value (`1fr`) truncated long before the real
// right edge, leaving a dead gap to its right.
//
// Fix: actions float absolutely over the value's right edge (with a
// gradient mask), and the value grid column spans the full row. This
// test gates the value cell reaching the row's right edge at rest, and
// that the actions are still reachable on hover.

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      writeFileSync(
        join(claudeDir, 'test-project', 'value-width-fixture.jsonl'),
        [
          JSON.stringify({ type: 'user', sessionId: 'value-width', cwd: '/tmp/test-project', uuid: 'vw-1', timestamp: '2026-05-20T10:00:00Z', message: { role: 'user', content: 'key AKIAV3QFKW72ZDLNP4XX leaked, rotate it' } }),
          JSON.stringify({ type: 'assistant', uuid: 'vw-2', timestamp: '2026-05-20T10:00:01Z', message: { role: 'assistant', model: 'claude-sonnet-4', content: 'rotating' } }),
        ].join('\n'),
      )
    },
  })
})

test.afterAll(async () => { await ctx?.cleanup() })

test('finding value spans the full row width and actions stay reachable on hover', async () => {
  const { window } = ctx
  await waitForSync(window)
  await window.locator('[data-testid="sidebar-security"]').click()

  const row = window.locator('[data-testid="finding-row"]').first()
  await row.waitFor()
  const value = row.locator('[data-testid="finding-value"]')

  // At rest (no hover) the value CELL — the 1fr grid column holding the
  // value text plus the optional inline ⧉N cross-session badge — must
  // reach the row's right edge. Pre-fix a reserved `auto` action column
  // held it ~200px short; actions now float absolutely over the right,
  // so the column spans the row. (The value text itself is left-aligned
  // within the cell, with trailing room on wide windows.)
  const cell = row.locator('[data-testid="finding-value-cell"]')
  const rowBox = (await row.boundingBox())!
  const cellBox = (await cell.boundingBox())!
  expect((rowBox.x + rowBox.width) - (cellBox.x + cellBox.width)).toBeLessThan(40)

  // The value text is shown (not clipped to nothing by a reserved column).
  await expect(value).toBeVisible()

  // Hover surfaces the floating actions; they must be visible + enabled.
  await row.hover()
  const ignore = row.locator('[data-testid="ignore-button"]')
  await expect(ignore).toBeVisible()
  await expect(row.locator('[data-testid="purge-button"]')).toBeVisible()
  await expect(ignore).toBeEnabled()
})

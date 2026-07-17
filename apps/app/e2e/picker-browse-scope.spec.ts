import { test, expect } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

// Browser-side guard for the new pagination + virtualization behavior in
// CommandPalette. The flat scope test still lives in
// share-new-draft-picker-scope.spec.ts; this file focuses on the >50-session
// browse case that the 30-row cap used to block.

const BIG_PROJECT_DIR = '/tmp/spool-e2e-big-project'
const BIG_PROJECT_SESSION_COUNT = 75 // > RECENT_PAGE_SIZE (50)

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp({
    extraFixtures: ({ claudeDir }) => {
      // Claude derives a project subdir from the cwd; mirror its convention
      // (replace `/` with `-`) so the synthesized sessions group into a
      // single browseable project.
      const projectSlug = BIG_PROJECT_DIR.replace(/\//g, '-')
      const projectDir = join(claudeDir, projectSlug)
      mkdirSync(projectDir, { recursive: true })
      for (let i = 0; i < BIG_PROJECT_SESSION_COUNT; i++) {
        const ordinal = String(i).padStart(3, '0')
        const sessionId = `bulk-session-${ordinal}`
        // Stagger timestamps minute-by-minute so the bucket-by-date logic has
        // a deterministic ordering — newest = i=0.
        const ts = new Date(Date.UTC(2026, 0, 1, 10, i, 0)).toISOString()
        const userUuid = `${sessionId}-u`
        const assistantUuid = `${sessionId}-a`
        const lines = [
          JSON.stringify({
            type: 'user',
            sessionId,
            cwd: BIG_PROJECT_DIR,
            uuid: userUuid,
            timestamp: ts,
            message: { role: 'user', content: `Bulk session ${ordinal} kick-off` },
          }),
          JSON.stringify({
            type: 'assistant',
            uuid: assistantUuid,
            parentUuid: userUuid,
            timestamp: ts,
            message: {
              role: 'assistant',
              model: 'claude-sonnet-4-20250514',
              content: [{ type: 'text', text: `Reply for bulk session ${ordinal}` }],
            },
          }),
        ]
        writeFileSync(join(projectDir, `${sessionId}.jsonl`), lines.join('\n') + '\n')
      }
    },
  })
  await waitForSync(ctx.window)
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function openPicker(): Promise<void> {
  await ctx.window.locator('[data-testid="sidebar-shares"]').click()
  await expect(
    ctx.window.locator('[data-testid="shares-empty-start"], [data-testid="shares-draft-row"]').first(),
  ).toBeVisible({ timeout: 5000 })
  const empty = ctx.window.locator('[data-testid="shares-empty-start"]')
  const plus = ctx.window.locator('[data-testid="shares-new-draft"]')
  if (await empty.isVisible().catch(() => false)) {
    await empty.click()
  } else {
    await plus.click()
  }
  await expect(ctx.window.locator('[data-testid="new-draft-picker"]')).toBeVisible({ timeout: 5000 })
}

async function closePicker(): Promise<void> {
  const picker = ctx.window.locator('[data-testid="new-draft-picker"]')
  if (await picker.isVisible().catch(() => false)) {
    await ctx.window.keyboard.press('Escape')
    await expect(picker).toBeHidden({ timeout: 5000 })
  }
}

async function scopeToBigProject(): Promise<void> {
  await ctx.window.locator('[data-testid="new-draft-picker-scope-trigger"]').click()
  const popover = ctx.window.locator('[data-testid="new-draft-picker-scope-popover"]')
  await expect(popover).toBeVisible()
  // Find the project option whose label contains our bulk slug.
  const option = popover.locator('[data-testid="new-draft-picker-scope-option"][data-identity-key]:not([data-identity-key=""])')
    .filter({ hasText: /spool-e2e-big-project/i })
    .first()
  await expect(option).toBeVisible({ timeout: 3000 })
  await option.click()
  await expect(popover).toBeHidden({ timeout: 2000 })
}

test('scoping to a >50-session project paginates rather than capping at 30', async () => {
  await openPicker()
  await scopeToBigProject()

  const virtual = ctx.window.locator('[data-testid="new-draft-picker-virtual"]')
  await expect(virtual).toBeVisible({ timeout: 5000 })
  // Newest fixture (i=74) sits at row 0; its presence confirms the picker
  // bound to the scoped list.
  await expect(
    ctx.window.locator('[data-testid="new-draft-picker-row"]').filter({ hasText: 'Bulk session 074' }),
  ).toBeVisible({ timeout: 5000 })

  // Trigger pagination by scrolling to the oldest end (ordinal 000 lives
  // beyond the first 50 rows; scroll re-tries because a lone programmatic
  // scrollTo occasionally loses the race against Virtuoso's measurement).
  await expect.poll(async () => {
    await virtual.evaluate((node) => {
      const scroller = node.matches('[data-virtuoso-scroller]')
        ? node
        : node.querySelector('[data-virtuoso-scroller]')
      ;(scroller ?? node).scrollTo({ top: 1e7 })
    })
    return ctx.window
      .locator('[data-testid="new-draft-picker-row"]')
      .filter({ hasText: 'Bulk session 000' })
      .count()
  }, { timeout: 10000, intervals: [200, 300, 500, 500, 1000] }).toBeGreaterThan(0)

  await closePicker()
})

test('switching scope back to Any project resets the list to page 1', async () => {
  await openPicker()
  await scopeToBigProject()

  const virtual = ctx.window.locator('[data-testid="new-draft-picker-virtual"]')
  await expect(virtual).toBeVisible({ timeout: 5000 })

  await ctx.window.locator('[data-testid="new-draft-picker-scope-clear"]').click()
  // After clearing, the list re-fetches page 1 for "all projects". The
  // virtual container should still be visible (recents path); the bulk
  // sessions are now interleaved with other fixtures, but the list must
  // not get stuck on the previous scope's row count.
  await expect(virtual).toBeVisible({ timeout: 3000 })
  await expect(ctx.window.locator('[data-testid="new-draft-picker-row"]').first()).toBeVisible({ timeout: 3000 })

  await closePicker()
})

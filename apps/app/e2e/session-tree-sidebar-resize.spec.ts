import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { test, expect } from '@playwright/test'

import { launchApp, waitForSync, type AppContext } from './helpers/launch'

const ROOT_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CHILD_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

let ctx: AppContext

test.beforeEach(async () => {
  ctx = await launchApp({
    extraFixtures: ({ codexDir }) => {
      const dayDir = join(codexDir, '2026', '07', '19')
      mkdirSync(dayDir, { recursive: true })
      writeCodexSession(dayDir, ROOT_UUID, '12-00-00', '2026-07-19T12:00:00Z', null)
      writeCodexSession(dayDir, CHILD_UUID, '12-01-00', '2026-07-19T12:01:00Z', ROOT_UUID)
    },
  })
})

test.afterEach(async () => {
  await ctx?.cleanup()
})

test('library renders Codex child sessions as a collapsed tree', async () => {
  const { window } = ctx
  await waitForSync(window)
  await window.locator('[data-testid="sidebar-library"]').click()

  const root = window.locator(`[data-testid="session-row"][data-session-uuid="${ROOT_UUID}"]`)
  const child = window.locator(`[data-testid="session-row"][data-session-uuid="${CHILD_UUID}"]`)
  await expect(root).toBeVisible()
  await expect(child).toBeHidden()

  const toggle = root.locator('[data-testid="session-tree-toggle"]')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.focus()
  await toggle.press('Enter')

  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(child).toBeVisible()
  await expect(child).toHaveAttribute('data-tree-depth', '1')
  await expect(window.locator('[data-testid="session-detail"]')).toHaveCount(0)
})

test('sidebar separator supports keyboard, drag, reset, and persistence', async () => {
  const { window } = ctx
  const sidebar = window.locator('[data-testid="sidebar"]')
  const handle = window.locator('[data-testid="sidebar-resize-handle"]')
  await expect(handle).toBeVisible()

  await handle.focus()
  await handle.press('ArrowRight')
  await expect(handle).toHaveAttribute('aria-valuenow', '248')
  expect(Math.round((await sidebar.boundingBox())!.width)).toBe(248)

  const box = await handle.boundingBox()
  if (!box) throw new Error('sidebar resize handle has no bounding box')
  await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await window.mouse.down()
  await window.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2)
  await window.mouse.up()
  await expect(handle).toHaveAttribute('aria-valuenow', '280')

  expect(await window.evaluate(() => localStorage.getItem('spool:sidebar-width'))).toBe('280')
  await handle.dblclick()
  await expect(handle).toHaveAttribute('aria-valuenow', '240')
  expect(await window.evaluate(() => localStorage.getItem('spool:sidebar-width'))).toBe('240')
})

function writeCodexSession(
  dir: string,
  uuid: string,
  fileTime: string,
  timestamp: string,
  parentSessionUuid: string | null,
): void {
  const sessionMeta = {
    timestamp,
    type: 'session_meta',
    payload: {
      id: uuid,
      cwd: '/tmp/tree-project',
      ...(parentSessionUuid
        ? {
            parent_thread_id: parentSessionUuid,
            thread_source: 'subagent',
            source: { subagent: 'review' },
          }
        : { source: 'cli' }),
    },
  }
  const userMessage = {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message: parentSessionUuid ? 'Review the parent session.' : 'Implement the parent feature.',
    },
  }
  const filePath = join(dir, `rollout-2026-07-19T${fileTime}-${uuid}.jsonl`)
  writeFileSync(filePath, `${JSON.stringify(sessionMeta)}\n${JSON.stringify(userMessage)}\n`)
}

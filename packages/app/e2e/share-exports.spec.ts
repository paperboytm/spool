import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import {
  installSaveFilePickerMock,
  openShareEditorFromSessionDetail,
  waitForSavedFile,
} from './helpers/share'

let ctx: AppContext

const SESSION_UUID = 'test-session-uuid-001'

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function exportAs(window: Awaited<ReturnType<typeof launchApp>>['window'], k: 'png' | 'pdf' | 'md' | 'spool') {
  // Old surface: <DownloadButton> exposed a flat trigger + per-format option.
  // New surface: <ShareMenu> popover. When VITE_FEATURE_SHAREPUBLISH is
  // unset, the popover opens directly on the Export tab (no tab strip).
  // When VITE_FEATURE_SHAREPUBLISH=1 (now the case in CI's test:e2e build,
  // see packages/app/package.json), the tab strip renders and the
  // popover opens on the Publish tab by default — so the test must
  // click the Export tab before picking a format. count() check makes
  // this work in both flag configurations.
  await window.locator('[data-testid="share-menu-trigger"]').click()
  await window.locator('[data-testid="share-menu-popover"]').waitFor({ state: 'visible' })
  const exportTab = window.locator('[data-testid="share-menu-tab-export"]')
  if (await exportTab.count()) await exportTab.click()
  await window.locator(`[data-testid="share-menu-export-${k}"]`).click()
  await window.locator('[data-testid="share-menu-download"]').click()
}

test('.spool export captures a valid SpoolDocument', async () => {
  const { window } = ctx
  await waitForSync(window)
  await openShareEditorFromSessionDetail(window, SESSION_UUID)
  await installSaveFilePickerMock(window)

  await exportAs(window, 'spool')

  const saved = await waitForSavedFile(window, '.spool')
  expect(saved.filename).toMatch(/\.spool$/)
  expect(saved.bytes.byteLength).toBeGreaterThan(0)
  const text = new TextDecoder().decode(saved.bytes)
  const doc = JSON.parse(text) as {
    version: number
    conversation: { turns: unknown[]; title: string }
    opts: { template: string }
  }
  expect(doc.version).toBe(2)
  expect(doc.opts.template).toBe('chat')
  expect(Array.isArray(doc.conversation.turns)).toBe(true)
  expect(doc.conversation.turns.length).toBeGreaterThan(0)
})

test('Markdown export captures frontmatter + body', async () => {
  const { window } = ctx
  // Editor still open from the previous test in the same browser context.
  await installSaveFilePickerMock(window)

  await exportAs(window, 'md')

  const saved = await waitForSavedFile(window, '.md')
  expect(saved.filename).toMatch(/\.md$/)
  const text = new TextDecoder().decode(saved.bytes)
  // Frontmatter delimiters at top.
  expect(text.startsWith('---\n')).toBe(true)
  expect(text).toMatch(/\n---\n/)
  // At least one of the conversation roles renders as a heading-like marker.
  expect(text.toLowerCase()).toMatch(/user|assistant|claude/i)
  // And some recognisable fixture content from test-session-001.
  expect(text).toContain('XYLOPHONE_CANARY_42')
})

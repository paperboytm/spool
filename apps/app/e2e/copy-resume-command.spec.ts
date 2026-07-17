import { test, expect } from '@playwright/test'
import { launchApp, search, waitForSync, type AppContext } from './helpers/launch'

// Regression coverage for issue #248: every "Copy resume command" menu item
// must produce `cd '<cwd>' && <cli> --resume '<uuid>'`, never the bare
// resume command (which would launch the agent in the wrong directory).

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

async function installClipboardSpy() {
  const { window } = ctx
  await window.evaluate(() => {
    const w = window as unknown as { __copiedTexts: string[] }
    w.__copiedTexts = []
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__copiedTexts.push(text)
        },
        readText: async () => '',
      },
    })
  })
}

async function readCopied(): Promise<string[]> {
  const { window } = ctx
  return window.evaluate(() => (window as unknown as { __copiedTexts: string[] }).__copiedTexts)
}

test('SessionRow Copy resume command includes cd <cwd> prefix', async () => {
  const { window } = ctx
  await waitForSync(window)
  await installClipboardSpy()

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const row = window.locator('[data-testid="session-row"]').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await window.getByRole('menuitem', { name: /Copy resume command/ }).click()

  const copied = await readCopied()
  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatch(/^cd '[^']+' && (claude|codex|gemini) /)
})

test('SessionDetail Copy resume command includes cd <cwd> prefix', async () => {
  const { window } = ctx
  await waitForSync(window)
  await installClipboardSpy()

  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  await window.locator('[data-testid="session-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible({ timeout: 5000 })

  await window.locator('[data-testid="detail-actions-menu"] button').first().click()
  await window.getByRole('menuitem', { name: /Copy resume command/ }).click()

  const copied = await readCopied()
  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatch(/^cd '[^']+' && (claude|codex|gemini) /)
})

test('Sidebar pinned row Copy resume command includes cd <cwd> prefix', async () => {
  const { window } = ctx
  await waitForSync(window)
  await installClipboardSpy()

  // Pin a session from the project view, then surface its sidebar entry.
  await window.locator('[data-testid="sidebar-project-row"]').first().click()
  const firstRow = window.locator('[data-testid="session-row"]').first()
  await expect(firstRow).toBeVisible({ timeout: 5000 })
  const uuid = await firstRow.getAttribute('data-session-uuid')
  expect(uuid).toBeTruthy()
  await firstRow.hover()
  await firstRow.locator('[data-testid="pin-button"]').click()

  const pinnedRow = window.locator(`[data-testid="sidebar-pinned-row"][data-session-uuid="${uuid}"]`)
  await expect(pinnedRow).toBeVisible({ timeout: 5000 })
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-menu-trigger"]').click()
  await window.getByRole('menuitem', { name: /Copy resume command/ }).click()

  const copied = await readCopied()
  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatch(/^cd '[^']+' && (claude|codex|gemini) /)

  // Cleanup: unpin so other tests in this file aren't affected.
  await pinnedRow.hover()
  await pinnedRow.locator('[data-testid="sidebar-pinned-unpin"]').click()
})

test('Fragment row Copy resume command includes cd <cwd> prefix', async () => {
  const { window } = ctx
  await waitForSync(window)
  await installClipboardSpy()

  await search(window, 'XYLOPHONE_CANARY_42')
  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await window.getByRole('menuitem', { name: /Copy resume command/ }).click()

  const copied = await readCopied()
  expect(copied).toHaveLength(1)
  expect(copied[0]).toMatch(/^cd '[^']+' && (claude|codex|gemini) /)
})

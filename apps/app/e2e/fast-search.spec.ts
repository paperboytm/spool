import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, search, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('home view shows title and session counts after sync', async () => {
  const { window } = ctx

  await expect(window.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 5000 })
  await waitForSync(window)
  await expect(window.locator('[data-testid="session-row"]').first()).toBeVisible({ timeout: 5000 })
})

test('search finds fixture content by canary keyword', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')

  const rows = window.locator('[data-testid="fragment-row"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
})

test('search result snippet contains highlighted match', async () => {
  const { window } = ctx

  // FTS snippet wraps matches in <mark> → rendered as <strong>
  const snippet = window.locator('[data-testid="fragment-row"] strong').first()
  await expect(snippet).toBeVisible()
  await expect(snippet).toContainText('XYLOPHONE_CANARY_42')
})

test('search result shows session metadata', async () => {
  const { window } = ctx

  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row.locator('[data-testid="source-badge"]')).toBeVisible()
  await row.hover()
  await expect(row.getByRole('button', { name: 'More actions' })).toBeVisible()
})

test('search for different canary finds separate session', async () => {
  const { window } = ctx

  await search(window, 'TROMBONE_CANARY_99')

  const rows = window.locator('[data-testid="fragment-row"]')
  await expect(rows.first()).toBeVisible({ timeout: 5000 })
  await expect(rows.first()).toContainText('TROMBONE_CANARY_99')
})

test('search for non-existent keyword shows no results', async () => {
  const { window } = ctx

  await search(window, 'ZZZZZ_NONEXISTENT_99999')

  await expect(window.locator('text=No results')).toBeVisible({ timeout: 5000 })
  await expect(window.locator('[data-testid="fragment-row"]')).toHaveCount(0)
})

test('codex search results expose resume-related actions', async () => {
  const { window } = ctx

  await search(window, 'BASSOON_CANARY_77')

  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row.locator('[data-testid="source-badge"][data-source="codex"]')).toBeVisible()

  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await expect(window.getByRole('menuitem', { name: 'Resume in terminal' })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: 'Copy resume command' })).toBeVisible()
  await window.keyboard.press('Escape')
})

test('gemini search results expose resume-related actions', async () => {
  const { window } = ctx

  await search(window, 'OBOE_CANARY_55')

  const row = window.locator('[data-testid="fragment-row"]').first()
  await expect(row).toBeVisible({ timeout: 5000 })
  await expect(row.locator('[data-testid="source-badge"][data-source="gemini"]')).toBeVisible()

  await row.hover()
  await row.getByRole('button', { name: 'More actions' }).click()
  await expect(window.getByRole('menuitem', { name: 'Resume in terminal' })).toBeVisible()
  await expect(window.getByRole('menuitem', { name: 'Copy resume command' })).toBeVisible()
  await window.keyboard.press('Escape')
})

test('whitespace-separated terms narrow shared PR number matches', async () => {
  const { window } = ctx

  await search(window, '4242')

  const broadRows = window.locator('[data-testid="fragment-row"]')
  await expect(broadRows).toHaveCount(3)
  await expect(window.locator('[data-testid="match-count"]').first()).toContainText('2 matches')

  await search(window, '查看一下 4242')

  const narrowedRows = window.locator('[data-testid="fragment-row"]')
  await expect(narrowedRows).toHaveCount(2)
  await expect(narrowedRows.first()).toContainText('请直接查看一下 4242 这个变更。')
  await expect(narrowedRows.nth(1)).toContainText('可以帮我查看一下这个变更单 4242 的结论吗？')
})

test('session page can submit a new search without returning home first', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await search(window, 'TROMBONE_CANARY_99')

  await expect(window.locator('[data-testid="session-detail"]')).toHaveCount(0)
  await expect(window.locator('[data-testid="fragment-row"]').first()).toContainText('TROMBONE_CANARY_99')
})

test('clicking an All-view fragment row jumps to message with flash highlight', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()

  const target = window.locator('[data-testid="target-message"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await expect(target).toHaveAttribute('data-highlighted', '1')
  await expect(target).not.toHaveAttribute('data-highlighted', '1', { timeout: 5000 })
})

test('source-filtered click still jumps to message with flash highlight', async () => {
  const { window } = ctx

  // Multi-source query so the filter tabs render.
  await search(window, 'CANARY')
  // Switch to the claude filter tab, then click a surviving row.
  await window.getByRole('button', { name: 'Claude Code', exact: true }).click()
  await window.locator('[data-testid="fragment-row"]').first().click()

  const target = window.locator('[data-testid="target-message"]')
  await expect(target).toBeVisible({ timeout: 5000 })
  await expect(target).toHaveAttribute('data-highlighted', '1')
})

test('session page supports cmd or ctrl + f find-in-page', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')

  const findInput = window.locator('[data-testid="session-find-input"]')
  await expect(findInput).toBeVisible()
  await expect(findInput).toBeFocused()

  await findInput.fill('XYLOPHONE')
  await window.locator('[data-testid="session-detail"]').click()
  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
  await expect(findInput).toBeFocused()
  await findInput.type('_CANARY_42')
  await expect(findInput).toHaveValue('XYLOPHONE_CANARY_42')
  await expect(window.locator('[data-testid="session-find-status"]')).toContainText(/\d+\s+of\s+\d+/, { timeout: 5000 })
  await expect(window.locator('[data-testid="session-find-active-match"]').first()).toContainText('XYLOPHONE_CANARY_42')
})

test('session find supports cmd or ctrl + arrow navigation', async () => {
  const { window } = ctx

  await search(window, 'XYLOPHONE_CANARY_42')
  await window.locator('[data-testid="fragment-row"]').first().click()
  await expect(window.locator('[data-testid="session-detail"]')).toBeVisible()

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')

  const findInput = window.locator('[data-testid="session-find-input"]')
  const status = window.locator('[data-testid="session-find-status"]')

  await findInput.fill('the')
  await expect(status).toContainText(/1\s+of\s+[2-9]\d*/, { timeout: 5000 })

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
  await expect(status).toContainText(/2\s+of\s+[2-9]\d*/, { timeout: 5000 })

  await window.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Control+ArrowLeft')
  await expect(status).toContainText(/1\s+of\s+[2-9]\d*/, { timeout: 5000 })
})

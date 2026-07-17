import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import type { Page } from '@playwright/test'

async function searchInAgentMode(window: Page, query: string) {
  const overlay = window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await window.locator('[data-testid="sidebar-search"]').first().click()
  }
  const input = window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await window.locator('[data-testid="mode-agent"]').click()
  await input.fill(query)
  await input.press('Enter')
  await expect(overlay).toBeHidden({ timeout: 2000 })
}

test.describe('Agent mode — success', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'success' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('streams answer with trust label and tool calls', async () => {
    const { window } = ctx

    await waitForSync(window)
    await searchInAgentMode(window, 'XYLOPHONE_CANARY_42')

    const card = window.locator('[data-testid="ai-answer-card"]')
    await expect(card).toBeVisible({ timeout: 15000 })

    const answerText = window.locator('[data-testid="ai-answer-text"]')
    await expect(answerText).toContainText('MOCK_ACP_RESPONSE_42', { timeout: 10000 })

    await expect(card).toContainText('via ACP')
    await expect(card).toContainText('local')
    await expect(card).toContainText('says')
    await expect(card).toContainText('Searching knowledge base')
  })

  test('shows FTS sources when search has matches', async () => {
    const { window } = ctx
    await expect(window.locator('text=Sources used')).toBeVisible({ timeout: 3000 })
  })

  test('second query replaces previous answer', async () => {
    const { window } = ctx
    await searchInAgentMode(window, 'another question')
    const answerText = window.locator('[data-testid="ai-answer-text"]')
    await expect(answerText).toContainText('MOCK_ACP_RESPONSE_42', { timeout: 10000 })
  })
})

test.describe('Agent mode — error', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'error' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('shows error with useful message and trust label', async () => {
    const { window } = ctx

    await waitForSync(window)
    await searchInAgentMode(window, 'test query')

    const card = window.locator('[data-testid="ai-answer-card"]')
    await expect(card).toBeVisible({ timeout: 15000 })

    const errorEl = window.locator('[data-testid="ai-error"]')
    await expect(errorEl).toBeVisible({ timeout: 10000 })
    await expect(errorEl).toContainText('unavailable')

    await expect(card).toContainText('via ACP')
  })
})

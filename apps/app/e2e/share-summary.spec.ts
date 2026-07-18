import { expect, test } from '@playwright/test'

import { launchApp, waitForSync, type AppContext } from './helpers/launch'
import { continueWithFullConversation, openSessionDetail } from './helpers/share'

const SESSION_UUID = 'test-session-uuid-001'

test.describe('agent summary share preflight', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'success' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('asks by default, names the local agent, and opens the Hub summary review', async () => {
    const { window } = ctx
    await waitForSync(window)
    await openSessionDetail(window, SESSION_UUID)
    await window.locator('[data-testid="detail-share"]').click()

    const dialog = window.locator('[data-testid="share-session-dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await expect(dialog.locator('[data-testid="share-summary-option"]')).toHaveAttribute(
      'data-selected',
      '',
    )
    await expect(dialog).toContainText('Claude Code')
    const trustLabel = dialog.locator('[data-testid="share-summary-trust-label"]')
    await expect(trustLabel).toContainText('ACP')
    await expect(trustLabel).toContainText('Claude Code')
    await expect(dialog.locator('[data-testid="share-summary-agent-disclosure"]')).not.toBeEmpty()

    await dialog.locator('[data-testid="share-session-continue"]').click()
    const hubDialog = window.locator('[data-testid="hub-share-dialog"]')
    await expect(hubDialog).toBeVisible({ timeout: 15_000 })
    await expect(hubDialog.locator('[data-testid="hub-share-summary"]')).toHaveValue(
      /MOCK_SUMMARY_RESPONSE_42/,
    )
    await expect(hubDialog.locator('[data-testid="hub-share-publish"]')).toBeVisible()
  })
})

test.describe('agent summary failure', () => {
  let ctx: AppContext

  test.beforeAll(async () => {
    ctx = await launchApp({ mockAgent: 'error' })
  })

  test.afterAll(async () => {
    await ctx?.cleanup()
  })

  test('keeps the choice open with an actionable full-conversation fallback', async () => {
    const { window } = ctx
    await waitForSync(window)
    await openSessionDetail(window, SESSION_UUID)
    await window.locator('[data-testid="detail-share"]').click()

    const dialog = window.locator('[data-testid="share-session-dialog"]')
    await dialog.locator('[data-testid="share-session-continue"]').click()
    const error = dialog.locator('[data-testid="share-summary-error"]')
    await expect(error).toBeVisible({ timeout: 10_000 })
    await expect(error).toContainText('model unavailable')

    await continueWithFullConversation(window)
    await expect(window.locator('[data-testid="share-editor-page"]')).toBeVisible({ timeout: 5000 })
  })
})

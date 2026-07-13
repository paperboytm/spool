import { test, expect } from '@playwright/test'
import { launchApp, waitForSync, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

const cmdK = process.platform === 'darwin' ? 'Meta+k' : 'Control+k'

test('Esc closes Settings panel', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()

  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
})

test('cmd/ctrl+K opens search overlay on home', async () => {
  const { window } = ctx
  await waitForSync(window)

  await expect(window.locator('[data-testid="search-overlay"]')).toBeHidden()
  await window.keyboard.press(cmdK)
  await expect(window.locator('[data-testid="search-overlay"]')).toBeVisible()
  // Overlay's Esc handler lives on its input — wait for focus before pressing.
  await expect(window.locator('[data-testid="search-overlay-input"]')).toBeFocused()
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="search-overlay"]')).toBeHidden()
})

test('Share and Security ship on: sidebar entries present, no Labs tab', async () => {
  const { window } = ctx
  await waitForSync(window)

  // Neither entry needs an env flag or an agents.json opt-in anymore.
  await expect(window.locator('[data-testid="sidebar-shares"]')).toBeVisible()
  await expect(window.locator('[data-testid="sidebar-security"]')).toBeVisible()

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()
  await expect(window.locator('[data-testid="settings-tab-labs"]')).toHaveCount(0)

  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
})

test('General → About keeps the feedback link after the Labs tab removal', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()

  const link = window.locator('[data-testid="settings-feedback-link"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', /discord\.com|discord\.gg/)
  await expect(link).toHaveAttribute('target', '_blank')

  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
})

test('Account leads the settings rail; the local-data footer is gone', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()

  const sidebar = window.locator('[data-testid="settings-sidebar"]')
  await expect(sidebar.locator('[aria-pressed]').first()).toHaveAttribute(
    'data-testid',
    'settings-tab-account',
  )
  // Every locale's footer copy contained the literal ~/.spool/ path,
  // so this probe is locale-independent.
  await expect(sidebar.getByText('~/.spool/')).toHaveCount(0)

  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()
})

test('cmd/ctrl+K is suppressed while Settings is open', async () => {
  const { window } = ctx
  await waitForSync(window)

  await window.locator('[data-testid="settings-button"]').click()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()

  await window.keyboard.press(cmdK)
  // Search overlay must NOT open while Settings is on top
  await expect(window.locator('[data-testid="search-overlay"]')).toBeHidden()
  await expect(window.locator('[data-testid="settings-panel"]')).toBeVisible()

  // Esc closes Settings; then ⌘K should work again
  await window.keyboard.press('Escape')
  await expect(window.locator('[data-testid="settings-panel"]')).toBeHidden()

  await window.keyboard.press(cmdK)
  await expect(window.locator('[data-testid="search-overlay"]')).toBeVisible()
  await expect(window.locator('[data-testid="search-overlay-input"]')).toBeFocused()
  await window.keyboard.press('Escape')
})

import { test, expect } from '@playwright/test'
import { launchApp, type AppContext } from './helpers/launch'

let ctx: AppContext

test.beforeAll(async () => {
  ctx = await launchApp()
})

test.afterAll(async () => {
  await ctx?.cleanup()
})

test('window recovers after close → activate cycle', async () => {
  const { app } = ctx

  const firstWindow = await app.firstWindow()

  // Arm the 'window' listener BEFORE close + activate so we deterministically
  // catch the new BrowserWindow. ElectronApplication.firstWindow() is racy
  // across a close/recreate cycle: it can return the just-closed page (dead
  // locators) or block until test timeout because the new window isn't yet
  // tracked internally.
  const restoredP = app.waitForEvent('window')
  await firstWindow.close()
  await app.evaluate(({ app: a }) => a.emit('activate'))
  const restored = await restoredP
  await restored.waitForLoadState('domcontentloaded')
  await expect(restored.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 10000 })

  // Second cycle — this is where the original bug manifested. Same arming
  // pattern keeps the assertion deterministic.
  const restoredAgainP = app.waitForEvent('window')
  await restored.close()
  await app.evaluate(({ app: a }) => a.emit('activate'))
  const restoredAgain = await restoredAgainP
  await restoredAgain.waitForLoadState('domcontentloaded')
  await expect(restoredAgain.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 10000 })
})

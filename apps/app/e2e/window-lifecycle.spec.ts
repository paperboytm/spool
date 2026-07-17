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
  await closeAndAwaitDestroy(firstWindow, app)
  const restored = await activateAndAwaitNewWindow(app)
  await expect(restored.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 10000 })

  // Second cycle — this is where the original bug manifested.
  await closeAndAwaitDestroy(restored, app)
  const restoredAgain = await activateAndAwaitNewWindow(app)
  await expect(restoredAgain.locator('[data-testid="library-landing"]')).toBeVisible({ timeout: 10000 })
})

// page.close() returns when the renderer Page is gone, but the main-process
// BrowserWindow 'closed' event (which nulls mainWindow) fires a tick later.
// Without this poll, showOrCreateWindow can race and hit the `.show()` branch
// on a half-destroyed window — no new BrowserWindow is created, so the
// 'window' event we arm below never fires and the test stalls until timeout.
async function closeAndAwaitDestroy(page: import('@playwright/test').Page, app: import('@playwright/test').ElectronApplication) {
  await page.close()
  await app.evaluate(({ BrowserWindow }) => new Promise<void>((resolve) => {
    const tick = () => BrowserWindow.getAllWindows().length === 0 ? resolve() : setTimeout(tick, 25)
    tick()
  }))
}

async function activateAndAwaitNewWindow(app: import('@playwright/test').ElectronApplication) {
  const newWindow = app.waitForEvent('window')
  await app.evaluate(({ app: a }) => a.emit('activate'))
  const page = await newWindow
  await page.waitForLoadState('domcontentloaded')
  return page
}

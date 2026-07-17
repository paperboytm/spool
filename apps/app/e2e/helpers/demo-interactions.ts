/**
 * Spool-specific UI interactions that release-video capture scripts reach for.
 * Kept thin and orthogonal — combine them in per-release recording flows.
 */
import { expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

import type { AppContext } from './demo-launch'

export type UpdateStatusPayload =
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message?: string }

/**
 * Push an updater-state IPC event into the renderer so the Auto-update banner
 * paints the requested state without needing a real download cycle.
 */
export async function emitUpdateStatus(app: ElectronApplication, payload: UpdateStatusPayload): Promise<void> {
  await app.evaluate(async ({ BrowserWindow }, data) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No Electron window found')
    win.webContents.send('spool:update-status', data)
  }, payload)
  await new Promise(resolve => setTimeout(resolve, 200))
}

/**
 * Click the first session row inside the given project and press its pin
 * button (revealed on hover). Returns the pinned session's UUID for follow-up
 * assertions.
 */
export async function pinFirstRowInProject(window: Page, projectName: string): Promise<string> {
  const projectRow = window.locator('[data-testid="sidebar-project-row"]').filter({ hasText: projectName }).first()
  await expect(projectRow).toBeVisible({ timeout: 5000 })
  await projectRow.click()
  const sessionRow = window.locator('[data-testid="session-row"]').first()
  await expect(sessionRow).toBeVisible({ timeout: 5000 })
  const uuid = await sessionRow.getAttribute('data-session-uuid')
  if (!uuid) throw new Error('First session row has no data-session-uuid')
  await sessionRow.hover()
  await sessionRow.locator('[data-testid="pin-button"]').click()
  return uuid
}

/**
 * Reset a demo context by closing the existing app and relaunching with the
 * same seed. Useful between recording passes that mutate state (pinning,
 * collapsing sidebar, etc).
 */
export async function resetDemoContext(
  ctx: AppContext,
  relaunch: () => Promise<AppContext>,
): Promise<AppContext> {
  await ctx.cleanup()
  return relaunch()
}

/**
 * Launch the Spool Electron app pre-seeded with a programmatic project list
 * for release-video captures. Separate from `launchApp()` in `launch.ts`,
 * which uses the static test fixtures.
 */
import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildDemoFixtures, type ProjectSeed, type BuildDemoFixturesOptions } from './demo-fixtures'

const APP_DIR = join(__dirname, '..', '..')

export interface AppContext {
  app: ElectronApplication
  window: Page
  tmpDir: string
  cleanup: () => Promise<void>
}

export interface LaunchDemoOptions {
  /** Shallow JSON written to `agents.json` in SPOOL_HOME *before* Electron
   *  boots. Use this to seed feature flags the main process reads from
   *  the config file at startup — e.g. `{ securityEnabled: true }` for a
   *  Security capture. Stays feature-agnostic so future flags drop in
   *  without changing this signature. */
  agentsConfig?: Record<string, unknown>
}

/**
 * Build demo fixtures under a fresh tmpdir and launch Electron pointing at
 * them. Forces dark mode and disables GPU for deterministic frames.
 */
export async function launchDemoApp(
  projects: ProjectSeed[],
  fixtureOptions: BuildDemoFixturesOptions = {},
  launchOptions: LaunchDemoOptions = {},
): Promise<AppContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'spool-demo-capture-'))
  buildDemoFixtures(tmpDir, projects, fixtureOptions)

  if (launchOptions.agentsConfig) {
    const spoolHome = join(tmpDir, 'spool-home')
    mkdirSync(spoolHome, { recursive: true })
    writeFileSync(join(spoolHome, 'agents.json'), JSON.stringify(launchOptions.agentsConfig), 'utf8')
  }

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SPOOL_DATA_DIR: join(tmpDir, 'data'),
    SPOOL_ELECTRON_USER_DATA_DIR: join(tmpDir, 'electron-user-data'),
    SPOOL_HOME: join(tmpDir, 'spool-home'),
    SPOOL_CLAUDE_DIR: join(tmpDir, 'claude', 'projects'),
    SPOOL_CODEX_DIR: join(tmpDir, 'codex', 'sessions'),
    SPOOL_GEMINI_DIR: join(tmpDir, 'gemini-cli-home'),
    GEMINI_CLI_HOME: join(tmpDir, 'gemini-cli-home'),
    ELECTRON_DISABLE_GPU: '1',
    SPOOL_E2E_TEST: '1',
  }

  const args = [join(APP_DIR, 'out', 'main', 'index.js')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')

  const app = await electron.launch({ args, cwd: APP_DIR, env })
  const window = await app.firstWindow()

  return {
    app,
    window,
    tmpDir,
    cleanup: async () => {
      await app.close()
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

/**
 * Force the Electron window into the given logical size + dark theme.
 * Use `1080×740` to match the app's documented default for release videos.
 */
export async function setDemoWindowBounds(ctx: AppContext, width: number, height: number): Promise<void> {
  await ctx.app.evaluate(async ({ app, BrowserWindow, nativeTheme }, bounds) => {
    nativeTheme.themeSource = 'dark'
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No Electron window found')
    win.setBounds(bounds)
    win.center()
    win.show()
    app.focus({ steal: true })
  }, { width, height })
  await ctx.window.emulateMedia({ colorScheme: 'dark' })
  await ctx.window.waitForTimeout(300)
}

/**
 * Block until the library finishes its initial sync — status footer reports
 * a non-zero session count.
 */
export async function waitForDemoSync(window: Page): Promise<void> {
  await expect(window.locator('[data-testid="status-text"]')).toContainText(/[1-9]\d*\s+session/, { timeout: 15000 })
}

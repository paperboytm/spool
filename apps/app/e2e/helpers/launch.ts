import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FIXTURES_DIR = join(__dirname, '..', 'fixtures')
const MOCKS_DIR = join(__dirname, '..', 'mocks')
const APP_DIR = join(__dirname, '..', '..')

export interface AppContext {
  app: ElectronApplication
  window: Page
  dbPath: string
  /** Root tmpdir for this test run. Tracked explicitly so restartApp's
   *  cleanup doesn't have to reconstruct it from env-var string
   *  manipulation — fragile once extraEnv lets callers override
   *  SPOOL_DATA_DIR. */
  tmpDir: string
  env: Record<string, string>
  cleanup: () => Promise<void>
}

export async function launchApp(opts: {
  mockAgent?: 'success' | 'error'
  /** Mutate fixture dirs (e.g. inject extra sessions) after the base fixtures
   * have been copied and before Electron starts. Receives the resolved dirs. */
  extraFixtures?: (dirs: { claudeDir: string; codexDir: string; geminiCliHome: string; opencodeDir: string }) => void
  /** Extra env to merge into the Electron child process env. Used by the
   * share-publish e2e to point SPOOL_SHARE_BACKEND at the in-process
   * mock backend, which binds to a random port per test run and so
   * can't be expressed via static playwright.config.ts env. */
  extraEnv?: Record<string, string>
} = {}): Promise<AppContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'spool-e2e-'))

  const claudeDir = join(tmpDir, 'claude', 'projects')
  const codexDir = join(tmpDir, 'codex', 'sessions')
  const geminiCliHome = join(tmpDir, 'gemini-cli-home')
  // OpenCode has no base fixture, but it MUST be isolated: when
  // SPOOL_OPENCODE_DIR is unset the source resolver falls back to the
  // real `~/.local/share/opencode`, so the developer's actual OpenCode
  // sessions bleed into the test DB — non-deterministically shifting
  // ordering/counts and stalling first-launch sync (the "30s timeout"
  // flake that only reproduced on machines with real OpenCode data).
  const opencodeDir = join(tmpDir, 'opencode')
  cpSync(join(FIXTURES_DIR, 'claude-projects'), claudeDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'codex-sessions'), codexDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'gemini-cli-home'), geminiCliHome, { recursive: true })
  mkdirSync(opencodeDir, { recursive: true })

  opts.extraFixtures?.({ claudeDir, codexDir, geminiCliHome, opencodeDir })

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SPOOL_DATA_DIR: join(tmpDir, 'data'),
    SPOOL_ELECTRON_USER_DATA_DIR: join(tmpDir, 'electron-user-data'),
    SPOOL_HOME: join(tmpDir, 'spool-home'),
    SPOOL_CLAUDE_DIR: claudeDir,
    SPOOL_CODEX_DIR: codexDir,
    SPOOL_GEMINI_DIR: geminiCliHome,
    GEMINI_CLI_HOME: geminiCliHome,
    SPOOL_OPENCODE_DIR: opencodeDir,
    ELECTRON_DISABLE_GPU: '1',
    SPOOL_E2E_TEST: '1',
  }

  if (opts.mockAgent) {
    // Fake `claude` binary on PATH so detectAgents() finds an agent
    env['PATH'] = `${MOCKS_DIR}:${env['PATH'] ?? ''}`
    // Point ACP extension resolution to our mock script
    const mockScript = opts.mockAgent === 'error'
      ? join(MOCKS_DIR, 'acp-mock-agent-error.mjs')
      : join(MOCKS_DIR, 'acp-mock-agent.mjs')
    env['SPOOL_ACP_AGENT_BIN'] = mockScript
  }

  if (opts.extraEnv) {
    for (const [k, v] of Object.entries(opts.extraEnv)) {
      env[k] = v
    }
  }

  const spoolHome = join(tmpDir, 'spool-home')
  mkdirSync(spoolHome, { recursive: true })

  const args = [join(APP_DIR, 'out', 'main', 'index.js')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  // Force prefers-reduced-motion at the Chromium level so transitions /
  // animations resolve instantly — Playwright's "wait for element to be
  // stable" otherwise spins on CSS transitions and times out under CPU
  // contention. Only affects the Electron instance launched here, not
  // the production app.
  args.unshift('--force-prefers-reduced-motion')

  const app = await electron.launch({ args, cwd: APP_DIR, env })

  const window = await app.firstWindow()

  return {
    app,
    window,
    dbPath: join(tmpDir, 'data', 'spool.db'),
    tmpDir,
    env,
    cleanup: async () => {
      await app.close()
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

/**
 * Close the app and re-launch reusing the same env (SPOOL_HOME, data dir,
 * etc), so any persisted state survives. Returns a fresh AppContext that
 * shares the same tmpDir + cleanup target. The caller is responsible for
 * calling cleanup() on the returned context.
 */
export async function restartApp(ctx: AppContext): Promise<AppContext> {
  await ctx.app.close()
  const args = [join(APP_DIR, 'out', 'main', 'index.js')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  args.unshift('--force-prefers-reduced-motion')
  const app = await electron.launch({ args, cwd: APP_DIR, env: ctx.env })
  const window = await app.firstWindow()
  return {
    app,
    window,
    dbPath: ctx.dbPath,
    tmpDir: ctx.tmpDir,
    env: ctx.env,
    cleanup: async () => {
      await app.close()
      // Use the original ctx's tmpDir explicitly. Reconstructing from
      // SPOOL_DATA_DIR with a regex (the previous version) was fragile
      // once extraEnv let callers override SPOOL_DATA_DIR — the strip
      // wouldn't match and we'd silently leak the entire tmpdir.
      rmSync(ctx.tmpDir, { recursive: true, force: true })
    },
  }
}

export async function waitForSync(window: Page) {
  await expect(window.locator('[data-testid="status-text"]')).toContainText(/[1-9]\d*\s+session/, { timeout: 15000 })
}

export async function search(window: Page, query: string) {
  const overlay = window.locator('[data-testid="search-overlay"]')
  if (!(await overlay.isVisible().catch(() => false))) {
    await window.locator('[data-testid="sidebar-search"]').first().click()
  }
  const input = window.locator('[data-testid="search-overlay-input"]')
  await expect(input).toBeVisible({ timeout: 3000 })
  await input.fill(query)
  await input.press('Shift+Enter')
  await expect(window.locator('[data-testid="search-overlay"]')).toBeHidden({ timeout: 2000 })
}

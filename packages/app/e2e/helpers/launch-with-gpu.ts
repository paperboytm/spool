import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Variant of `launchApp` that does NOT set `ELECTRON_DISABLE_GPU=1`.
 * Chromium's built-in PDF viewer needs GPU rasterisation; with the
 * harness's default GPU-disable the iframe paints a blank rectangle
 * regardless of what's in the bytes. Use this helper for any spec
 * that needs to verify PDF rendering.
 */
const FIXTURES_DIR = join(__dirname, '..', 'fixtures')
const APP_DIR = join(__dirname, '..', '..')

export interface AppContext {
  app: ElectronApplication
  window: Page
  cleanup: () => Promise<void>
}

export async function launchAppWithGpu(): Promise<AppContext> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'spool-e2e-gpu-'))

  const claudeDir = join(tmpDir, 'claude', 'projects')
  const codexDir = join(tmpDir, 'codex', 'sessions')
  const geminiCliHome = join(tmpDir, 'gemini-cli-home')
  const opencodeDir = join(tmpDir, 'opencode')
  cpSync(join(FIXTURES_DIR, 'claude-projects'), claudeDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'codex-sessions'), codexDir, { recursive: true })
  cpSync(join(FIXTURES_DIR, 'gemini-cli-home'), geminiCliHome, { recursive: true })
  mkdirSync(opencodeDir, { recursive: true })

  const spoolHome = join(tmpDir, 'spool-home')
  mkdirSync(spoolHome, { recursive: true })
  writeFileSync(join(spoolHome, 'agents.json'), JSON.stringify({}), 'utf8')

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    SPOOL_DATA_DIR: join(tmpDir, 'data'),
    SPOOL_ELECTRON_USER_DATA_DIR: join(tmpDir, 'electron-user-data'),
    SPOOL_HOME: spoolHome,
    SPOOL_CLAUDE_DIR: claudeDir,
    SPOOL_CODEX_DIR: codexDir,
    SPOOL_GEMINI_DIR: geminiCliHome,
    GEMINI_CLI_HOME: geminiCliHome,
    SPOOL_OPENCODE_DIR: opencodeDir,
    SPOOL_E2E_TEST: '1',
    // Intentionally NOT setting ELECTRON_DISABLE_GPU — Chromium's PDF
    // viewer needs GPU rasterisation to paint.
  }

  const args = [join(APP_DIR, 'out', 'main', 'index.js')]
  if (process.platform === 'linux') args.unshift('--no-sandbox')
  args.unshift('--force-prefers-reduced-motion')

  const app = await electron.launch({ args, cwd: APP_DIR, env })
  const window = await app.firstWindow()
  return {
    app,
    window,
    cleanup: async () => {
      await app.close()
      rmSync(tmpDir, { recursive: true, force: true })
    },
  }
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SPOOL_DIR } from '@spool-lab/core'
import {
  normalizeThemeEditorState,
  type ThemeEditorStateV1,
  type ThemeSource,
} from '../renderer/theme/editorTypes.js'

interface UIConfigFile {
  themeSource?: unknown
  themeEditor?: unknown
  // `spoolDaemonNoticeShown` written by older builds is silently ignored on
  // read — left out of the type but tolerated in the on-disk JSON.
  sidebarCollapsed?: unknown
}

const UI_CONFIG_PATH = join(SPOOL_DIR, 'ui.json')

export interface UIPreferences {
  themeSource: ThemeSource
  themeEditor: ThemeEditorStateV1 | null
  sidebarCollapsed: boolean
}

function normalizeThemeSource(raw: unknown): ThemeSource {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

function readUIConfig(): UIConfigFile {
  try {
    if (!existsSync(UI_CONFIG_PATH)) return {}
    return JSON.parse(readFileSync(UI_CONFIG_PATH, 'utf8')) as UIConfigFile
  } catch {
    return {}
  }
}

function writeUIConfig(config: UIConfigFile): void {
  mkdirSync(SPOOL_DIR, { recursive: true })
  writeFileSync(UI_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
}

export function loadUIPreferences(): UIPreferences {
  const config = readUIConfig()
  return {
    themeSource: normalizeThemeSource(config.themeSource),
    themeEditor: normalizeThemeEditorState(config.themeEditor),
    sidebarCollapsed: config.sidebarCollapsed === true,
  }
}

export function saveSidebarCollapsed(sidebarCollapsed: boolean): void {
  const config = readUIConfig()
  writeUIConfig({ ...config, sidebarCollapsed })
}

export function saveThemeSource(themeSource: ThemeSource): void {
  const config = readUIConfig()
  writeUIConfig({ ...config, themeSource })
}

export function saveThemeEditor(themeEditor: ThemeEditorStateV1): void {
  const config = readUIConfig()
  writeUIConfig({ ...config, themeEditor })
}

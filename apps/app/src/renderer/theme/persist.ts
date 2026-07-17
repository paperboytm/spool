import {
  type ThemeEditorStateV1,
  type ThemeSideConfig,
  THEME_EDITOR_STORAGE_KEY,
  LEGACY_DARK_PALETTE_KEY,
  defaultThemeEditorState,
  normalizeThemeEditorState,
  normalizeThemeSide,
} from './editorTypes.js'
import { darkPresetSeed } from './presetSeeds.js'

/** Merge loose import (e.g. partial JSON) onto current state. */
export function mergeThemeImportLoose(raw: unknown, current: ThemeEditorStateV1): ThemeEditorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const next: ThemeEditorStateV1 = {
    v: 1,
    light: normalizeThemeSide((o['light'] as Partial<ThemeSideConfig>) ?? {}, current.light),
    dark: normalizeThemeSide((o['dark'] as Partial<ThemeSideConfig>) ?? {}, current.dark),
  }
  return next
}

export async function loadThemeEditorState(): Promise<ThemeEditorStateV1> {
  try {
    const stored = await window.spool?.getThemeEditorState?.()
    if (stored) {
      const parsed = normalizeThemeEditorState(stored)
      if (parsed) return parsed
    }

    const rawLocal = window.localStorage.getItem(THEME_EDITOR_STORAGE_KEY)
    if (rawLocal) {
      const parsed = normalizeThemeEditorState(JSON.parse(rawLocal))
      if (parsed) {
        await window.spool?.setThemeEditorState?.(parsed)
        return parsed
      }
    }

    const next = defaultThemeEditorState()
    const legacy = window.localStorage.getItem(LEGACY_DARK_PALETTE_KEY)
    if (legacy === 'forest') {
      next.dark = darkPresetSeed('everforest', next.dark)
      await window.spool?.setThemeEditorState?.(next)
    }
    return next
  } catch {
    return defaultThemeEditorState()
  }
}

export async function saveThemeEditorState(state: ThemeEditorStateV1): Promise<void> {
  window.localStorage.setItem(THEME_EDITOR_STORAGE_KEY, JSON.stringify(state))
  await window.spool?.setThemeEditorState?.(state)
}

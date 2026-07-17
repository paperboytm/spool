/** Persisted theme editor payload (Settings → Appearance). */

export const THEME_EDITOR_STORAGE_KEY = 'spool_theme_editor'
export const LEGACY_DARK_PALETTE_KEY = 'spool_dark_palette'
export type ThemeSource = 'system' | 'light' | 'dark'

export interface ThemeSideConfig {
  /** Last selected preset; switches to `custom` when user edits colors. */
  preset: string
  accent: string
  background: string
  foreground: string
  uiFont: string
  codeFont: string
  translucentChrome: boolean
  /** 0 = softer secondary text, 100 = stronger separation from background */
  contrast: number
}

export interface ThemeEditorStateV1 {
  v: 1
  light: ThemeSideConfig
  dark: ThemeSideConfig
}

/** Same palette names on light and dark sides (each side applies its own hex set). */
export const THEME_PRESETS = ['spool', 'solarized', 'everforest', 'custom'] as const
export type ThemePresetId = (typeof THEME_PRESETS)[number]

/** @deprecated Use THEME_PRESETS — kept for imports that expect separate lists */
export const LIGHT_PRESETS = THEME_PRESETS
export const DARK_PRESETS = THEME_PRESETS

const KNOWN_PRESETS = new Set<string>(THEME_PRESETS)

export function normalizePresetId(raw: string): string {
  const preset = raw === 'forest' ? 'everforest' : raw
  return KNOWN_PRESETS.has(preset) ? preset : 'custom'
}

export function normalizeThemeSide(
  partial: Partial<ThemeSideConfig> | undefined,
  fallback: ThemeSideConfig,
): ThemeSideConfig {
  if (!partial || typeof partial !== 'object') return { ...fallback }

  const presetRaw = typeof partial.preset === 'string' ? partial.preset : fallback.preset
  return {
    preset: normalizePresetId(presetRaw),
    accent: typeof partial.accent === 'string' ? partial.accent : fallback.accent,
    background: typeof partial.background === 'string' ? partial.background : fallback.background,
    foreground: typeof partial.foreground === 'string' ? partial.foreground : fallback.foreground,
    uiFont: typeof partial.uiFont === 'string' ? partial.uiFont : fallback.uiFont,
    codeFont: typeof partial.codeFont === 'string' ? partial.codeFont : fallback.codeFont,
    translucentChrome: typeof partial.translucentChrome === 'boolean' ? partial.translucentChrome : fallback.translucentChrome,
    contrast: typeof partial.contrast === 'number' && Number.isFinite(partial.contrast)
      ? Math.max(0, Math.min(100, Math.round(partial.contrast)))
      : fallback.contrast,
  }
}

export function normalizeThemeEditorState(raw: unknown): ThemeEditorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record['v'] !== 1) return null

  const defaults = defaultThemeEditorState()
  return {
    v: 1,
    light: normalizeThemeSide(record['light'] as Partial<ThemeSideConfig> | undefined, defaults.light),
    dark: normalizeThemeSide(record['dark'] as Partial<ThemeSideConfig> | undefined, defaults.dark),
  }
}

export function defaultLightSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#C85A00',
    background: '#FAFAF8',
    foreground: '#1C1C18',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultDarkSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#F07020',
    background: '#141410',
    foreground: '#F2F2EC',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultThemeEditorState(): ThemeEditorStateV1 {
  return { v: 1, light: defaultLightSide(), dark: defaultDarkSide() }
}

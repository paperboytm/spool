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
const LEGACY_SPOOL_LIGHT = {
  accent: '#C85A00',
  background: '#FAFAF8',
  foreground: '#1C1C18',
} as const
const LEGACY_SPOOL_DARK = {
  accent: '#F07020',
  background: '#141410',
  foreground: '#F2F2EC',
} as const

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
    translucentChrome:
      typeof partial.translucentChrome === 'boolean'
        ? partial.translucentChrome
        : fallback.translucentChrome,
    contrast:
      typeof partial.contrast === 'number' && Number.isFinite(partial.contrast)
        ? Math.max(0, Math.min(100, Math.round(partial.contrast)))
        : fallback.contrast,
  }
}

export function normalizeThemeEditorState(raw: unknown): ThemeEditorStateV1 | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  if (record['v'] !== 1) return null

  const defaults = defaultThemeEditorState()
  const normalized = {
    v: 1,
    light: normalizeThemeSide(
      record['light'] as Partial<ThemeSideConfig> | undefined,
      defaults.light,
    ),
    dark: normalizeThemeSide(record['dark'] as Partial<ThemeSideConfig> | undefined, defaults.dark),
  } satisfies ThemeEditorStateV1

  // The Paperboy rebrand changed the built-in Spool preset. Migrate only
  // exact legacy defaults so a genuinely customized palette remains intact.
  if (matchesLegacySpoolPreset(normalized.light, LEGACY_SPOOL_LIGHT)) {
    const next = defaultLightSide()
    normalized.light = {
      ...normalized.light,
      accent: next.accent,
      background: next.background,
      foreground: next.foreground,
    }
  }
  if (matchesLegacySpoolPreset(normalized.dark, LEGACY_SPOOL_DARK)) {
    const next = defaultDarkSide()
    normalized.dark = {
      ...normalized.dark,
      accent: next.accent,
      background: next.background,
      foreground: next.foreground,
    }
  }
  return normalized
}

function matchesLegacySpoolPreset(
  side: ThemeSideConfig,
  legacy: typeof LEGACY_SPOOL_LIGHT | typeof LEGACY_SPOOL_DARK,
): boolean {
  return (
    side.preset === 'spool' &&
    side.accent.toUpperCase() === legacy.accent &&
    side.background.toUpperCase() === legacy.background &&
    side.foreground.toUpperCase() === legacy.foreground
  )
}

export function defaultLightSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#1387FF',
    background: '#FFFFFF',
    foreground: '#0A0A0A',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultDarkSide(): ThemeSideConfig {
  return {
    preset: 'spool',
    accent: '#5BB1F0',
    background: '#000000',
    foreground: '#FFFFFF',
    uiFont: 'Geist Variable',
    codeFont: 'Geist Mono',
    translucentChrome: false,
    contrast: 45,
  }
}

export function defaultThemeEditorState(): ThemeEditorStateV1 {
  return { v: 1, light: defaultLightSide(), dark: defaultDarkSide() }
}

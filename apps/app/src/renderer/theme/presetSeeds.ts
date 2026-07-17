import type { ThemeSideConfig } from './editorTypes.js'
import { defaultDarkSide, defaultLightSide } from './editorTypes.js'

/** Non-custom entries in the preset dropdown */
export type NamedThemePreset = 'spool' | 'solarized' | 'everforest'

/** Reference: Solarized light — base3 / base00 / yellow, Inter + JetBrains Mono, high contrast. */
const SOLARIZED_LIGHT: Pick<
  ThemeSideConfig,
  'accent' | 'background' | 'foreground' | 'uiFont' | 'codeFont' | 'translucentChrome' | 'contrast'
> = {
  accent: '#B58900',
  background: '#FDF6E3',
  foreground: '#657B83',
  uiFont: 'Inter',
  codeFont: 'JetBrains Mono',
  translucentChrome: true,
  contrast: 100,
}

/** Solarized dark — canonical base03 / base0 / yellow; same font pairing as light. */
const SOLARIZED_DARK: Pick<
  ThemeSideConfig,
  'accent' | 'background' | 'foreground' | 'uiFont' | 'codeFont' | 'translucentChrome' | 'contrast'
> = {
  accent: '#B58900',
  background: '#002B36',
  foreground: '#839496',
  uiFont: 'Inter',
  codeFont: 'JetBrains Mono',
  translucentChrome: false,
  contrast: 100,
}

/**
 * Everforest dark — reference screenshot: lime accent, near-black green bg, sage fg,
 * system UI stack + mono code.
 */
const EVERFOREST_DARK: Pick<
  ThemeSideConfig,
  'accent' | 'background' | 'foreground' | 'uiFont' | 'codeFont' | 'translucentChrome' | 'contrast'
> = {
  accent: '#96F300',
  background: '#0B0F0D',
  foreground: '#81C57A',
  uiFont: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  codeFont: 'JetBrains Mono',
  translucentChrome: false,
  contrast: 100,
}

/** Everforest light — soft green/cream companion (no exact values in reference). */
const EVERFOREST_LIGHT: Pick<
  ThemeSideConfig,
  'accent' | 'background' | 'foreground' | 'uiFont' | 'codeFont' | 'translucentChrome' | 'contrast'
> = {
  accent: '#8DA101',
  background: '#FFFBEF',
  foreground: '#5C6A72',
  uiFont: 'Inter',
  codeFont: 'JetBrains Mono',
  translucentChrome: true,
  contrast: 100,
}

export function lightPresetSeed(id: NamedThemePreset, base: ThemeSideConfig): ThemeSideConfig {
  if (id === 'spool') {
    const d = defaultLightSide()
    return { ...base, preset: 'spool', accent: d.accent, background: d.background, foreground: d.foreground }
  }
  if (id === 'solarized') {
    return { ...base, preset: 'solarized', ...SOLARIZED_LIGHT }
  }
  return { ...base, preset: 'everforest', ...EVERFOREST_LIGHT }
}

export function darkPresetSeed(id: NamedThemePreset, base: ThemeSideConfig): ThemeSideConfig {
  if (id === 'spool') {
    const d = defaultDarkSide()
    return { ...base, preset: 'spool', accent: d.accent, background: d.background, foreground: d.foreground }
  }
  if (id === 'solarized') {
    return { ...base, preset: 'solarized', ...SOLARIZED_DARK }
  }
  return { ...base, preset: 'everforest', ...EVERFOREST_DARK }
}

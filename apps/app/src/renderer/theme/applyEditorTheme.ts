import { mixHex } from './colorUtils.js'
import type { ThemeEditorStateV1, ThemeSideConfig } from './editorTypes.js'

function fontStack(custom: string, fallback: string): string {
  const t = custom.trim()
  const lower = t.toLowerCase()
  if (
    !t ||
    lower === 'inter variable' ||
    lower === 'inter' ||
    lower === 'geist variable' ||
    lower === 'geist'
  ) {
    return fallback
  }
  if (/^["']/.test(t)) return `${t}, ${fallback}`
  if (t.includes(',')) return `${t}, ${fallback}`
  return `'${t}', ${fallback}`
}

function tokensForSide(slot: ThemeSideConfig, mode: 'light' | 'dark'): Record<string, string> {
  const { accent, background: bg, foreground: fg, contrast } = slot
  const c = Math.max(0, Math.min(100, contrast)) / 100
  // Contrast affects the whole chrome system, not just secondary text.
  // Higher values strengthen hierarchy in text, surfaces, and borders together.
  const mutedT = 0.18 + c * 0.38
  const faintT = 0.42 + c * 0.28
  const muted = mixHex(fg, bg, mutedT)
  const faint = mixHex(fg, bg, faintT)

  const surfaceT = mode === 'light' ? 0.018 + c * 0.05 : 0.028 + c * 0.05
  const surface2T = mode === 'light' ? 0.038 + c * 0.085 : 0.052 + c * 0.085
  const borderT = mode === 'light' ? 0.075 + c * 0.1 : 0.082 + c * 0.105
  const border2T = mode === 'light' ? 0.11 + c * 0.11 : 0.115 + c * 0.115

  const surface = mixHex(bg, fg, surfaceT)
  const surface2 = mixHex(bg, fg, surface2T)
  const border = mixHex(bg, fg, borderT)
  const border2 = mixHex(bg, fg, border2T)

  const accentBgLight = mixHex(accent, '#FFFFFF', 0.88)
  const accentBgDark = mixHex(accent, '#000000', 0.82)

  if (mode === 'light') {
    return {
      '--sp-bg': bg,
      '--sp-surface': surface,
      '--sp-surface-2': surface2,
      '--sp-surface2': 'var(--sp-surface-2)',
      '--sp-border': border,
      '--sp-border-strong': border2,
      '--sp-border2': 'var(--sp-border-strong)',
      '--sp-text': fg,
      '--sp-muted': muted,
      '--sp-faint': faint,
      '--sp-accent': accent,
      '--sp-accent-bg': accentBgLight,
    }
  }

  return {
    '--sp-bg': bg,
    '--sp-surface': surface,
    '--sp-surface-2': surface2,
    '--sp-surface2': 'var(--sp-surface-2)',
    '--sp-border': border,
    '--sp-border-strong': border2,
    '--sp-border2': 'var(--sp-border-strong)',
    '--sp-text': fg,
    '--sp-muted': muted,
    '--sp-faint': faint,
    '--sp-accent': accent,
    '--sp-accent-bg': accentBgDark,
  }
}

/**
 * Updates the active shared token set and mirrors Electron's effective theme
 * onto html.dark. Tailwind's legacy aliases and shared components therefore
 * read the same values without maintaining parallel palettes.
 */
export function applyEditorTheme(state: ThemeEditorStateV1): void {
  const root = document.documentElement
  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const active = isDark ? state.dark : state.light
  root.classList.toggle('dark', isDark)
  for (const [token, value] of Object.entries(tokensForSide(active, isDark ? 'dark' : 'light'))) {
    root.style.setProperty(token, value)
  }
  root.style.setProperty(
    '--sp-font-sans',
    fontStack(active.uiFont, `'Geist Variable', 'Geist', sans-serif`),
  )
  root.style.setProperty('--sp-font-mono', fontStack(active.codeFont, `'Geist Mono', monospace`))
}

export function themePreviewSnippet(state: ThemeEditorStateV1): string {
  const pick = (s: ThemeSideConfig) => ({
    surface: 'sidebar',
    accent: s.accent,
    contrast: s.contrast,
    background: s.background,
    foreground: s.foreground,
  })
  return `const themePreview: ThemeConfig = ${JSON.stringify({ light: pick(state.light), dark: pick(state.dark) }, null, 2)};`
}

import type { ThemeEditorStateV1, ThemeSideConfig } from './editorTypes.js'
import { mixHex } from './colorUtils.js'

function fontStack(custom: string, fallback: string): string {
  const t = custom.trim()
  const lower = t.toLowerCase()
  if (!t || lower === 'inter variable' || lower === 'inter' || lower === 'geist variable' || lower === 'geist') {
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

  const surfaceT = mode === 'light'
    ? 0.018 + c * 0.05
    : 0.028 + c * 0.05
  const surface2T = mode === 'light'
    ? 0.038 + c * 0.085
    : 0.052 + c * 0.085
  const borderT = mode === 'light'
    ? 0.075 + c * 0.1
    : 0.082 + c * 0.105
  const border2T = mode === 'light'
    ? 0.11 + c * 0.11
    : 0.115 + c * 0.115

  const surface = mixHex(bg, fg, surfaceT)
  const surface2 = mixHex(bg, fg, surface2T)
  const border = mixHex(bg, fg, borderT)
  const border2 = mixHex(bg, fg, border2T)

  const accentBgLight = mixHex(accent, '#FFFFFF', 0.88)
  const accentBgDark = mixHex(accent, '#000000', 0.82)

  if (mode === 'light') {
    return {
      '--color-warm-bg': bg,
      '--color-warm-surface': surface,
      '--color-warm-surface2': surface2,
      '--color-warm-border': border,
      '--color-warm-border2': border2,
      '--color-warm-text': fg,
      '--color-warm-muted': muted,
      '--color-warm-faint': faint,
      '--color-accent': accent,
      '--color-accent-bg': accentBgLight,
    }
  }

  return {
    '--color-dark-bg': bg,
    '--color-dark-surface': surface,
    '--color-dark-surface2': surface2,
    '--color-dark-border': border,
    '--color-dark-border2': border2,
    '--color-dark-text': fg,
    '--color-dark-muted': muted,
    '--color-dark-faint': faint,
    '--color-accent-dark': accent,
    '--color-accent-bg-dark': accentBgDark,
  }
}

/**
 * Pushes all semantic colors used by Tailwind `@theme` tokens onto `document.documentElement`.
 * Light and dark sets are both updated so OS / app theme switches stay instant.
 */
export function applyEditorTheme(state: ThemeEditorStateV1): void {
  const root = document.documentElement
  const lightTok = tokensForSide(state.light, 'light')
  const darkTok = tokensForSide(state.dark, 'dark')

  for (const [k, v] of Object.entries({ ...lightTok, ...darkTok })) {
    root.style.setProperty(k, v)
  }

  const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const active = isDark ? state.dark : state.light
  root.style.setProperty(
    '--font-sans',
    fontStack(active.uiFont, `'Inter Variable', system-ui, sans-serif`),
  )
  root.style.setProperty(
    '--font-mono',
    fontStack(active.codeFont, `'Geist Mono', ui-monospace, monospace`),
  )
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

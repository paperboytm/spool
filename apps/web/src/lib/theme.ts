// Unified theme contract for both surfaces: <html data-theme> is the
// source of truth, persisted under one key. Boot-time selection happens
// in the inline script in routes/__root.tsx (which also migrates reads
// from the split-era keys); everything else goes through these helpers.

const THEME_KEY = 'spool-theme'

export type Theme = 'light' | 'dark'

export function readThemeAttr(): Theme {
  const value = document.documentElement.getAttribute('data-theme')
  return value === 'dark' ? 'dark' : 'light'
}

export function writeThemeAttr(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore quota / private mode */
  }
}

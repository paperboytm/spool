export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim().replace(/^#/, '')
  if (h.length === 3 && /^[0-9a-fA-F]{3}$/.test(h)) {
    return {
      r: parseInt(h.charAt(0) + h.charAt(0), 16),
      g: parseInt(h.charAt(1) + h.charAt(1), 16),
      b: parseInt(h.charAt(2) + h.charAt(2), 16),
    }
  }
  if (h.length === 6 && /^[0-9a-fA-F]+$/.test(h)) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    }
  }
  return null
}

export function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${[c(r), c(g), c(b)].map((x) => x.toString(16).padStart(2, '0')).join('')}`
}

/** Mix a toward b (t=0 → a, t=1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a)
  const B = parseHex(b)
  if (!A || !B) return a
  const u = Math.max(0, Math.min(1, t))
  return toHex({
    r: A.r + (B.r - A.r) * u,
    g: A.g + (B.g - A.g) * u,
    b: A.b + (B.b - A.b) * u,
  })
}

/** sRGB relative luminance (WCAG), 0–1 */
export function relativeLuminance(hex: string): number {
  const p = parseHex(hex)
  if (!p) return 0.5
  const lin = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const R = lin(p.r)
  const G = lin(p.g)
  const B = lin(p.b)
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

export function hexToRgba(hex: string, alpha: number): string {
  const p = parseHex(hex)
  if (!p) return `rgba(0,0,0,${alpha})`
  const a = Math.max(0, Math.min(1, alpha))
  return `rgba(${p.r},${p.g},${p.b},${a})`
}

/** Label / chrome colors on top of a tinted card keyed by this background */
export function adaptiveCardTone(bgHex: string): {
  isLight: boolean
  primary: string
  muted: string
  faint: string
  trackOff: string
  knob: string
  inputBg: string
  inputBorder: string
} {
  const L = relativeLuminance(bgHex)
  const isLight = L > 0.5
  if (isLight) {
    return {
      isLight,
      primary: 'rgba(0,0,0,0.88)',
      muted: 'rgba(0,0,0,0.55)',
      faint: 'rgba(0,0,0,0.38)',
      trackOff: 'rgba(0,0,0,0.12)',
      knob: '#ffffff',
      inputBg: 'rgba(255,255,255,0.65)',
      inputBorder: 'rgba(0,0,0,0.14)',
    }
  }
  return {
    isLight,
    primary: 'rgba(255,255,255,0.92)',
    muted: 'rgba(255,255,255,0.62)',
    faint: 'rgba(255,255,255,0.42)',
    trackOff: 'rgba(255,255,255,0.12)',
    knob: 'rgba(255,255,255,0.95)',
    inputBg: 'rgba(0,0,0,0.35)',
    inputBorder: 'rgba(255,255,255,0.16)',
  }
}

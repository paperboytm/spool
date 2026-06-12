// Thin re-export so templates don't need to know about the canonical
// paper registry in types.ts. Keeps imports short at call sites.

export type { PaperTokens as TemplateTokens } from '@/lib/types'
export { paperTokens as templateTokens } from '@/lib/types'

/** Alpha-blended background tint for redact chips and other accent
 *  surfaces inside the rendered artifact. Derived from the colorway
 *  swatch (`opts.accentHex`) — NOT from the paper tokens — so the
 *  chip background follows whatever colorway the user picked. Paper
 *  composites underneath, so the same alpha looks coherent on both
 *  light and dark papers.
 *
 *  Default alpha is `0x26` (≈15%) which gives a subtle but visible
 *  tint: enough to mark the span as distinct from body prose, not so
 *  strong that it competes with surrounding chrome. */
export function accentBgFor(accentHex: string, alphaHex = '26'): string {
  // Accept #RGB / #RRGGBB; normalise to #RRGGBB then append alpha.
  const m = /^#([0-9a-f]{3,8})$/i.exec(accentHex.trim())
  if (!m) return accentHex
  let hex = m[1]!
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('')
  } else if (hex.length === 8) {
    hex = hex.slice(0, 6)
  } else if (hex.length !== 6) {
    return accentHex
  }
  return `#${hex}${alphaHex}`
}

/** CSS custom properties that carry the style-only Body inputs.
 *
 *  Templates set these on their ROOT element and hand `Body` literal
 *  `var(--sk-*)` references (see BODY_VAR_PROPS). Because the prop
 *  strings never change, a colorway / paper / typeface switch leaves
 *  every memoized Body untouched — the restyle happens entirely in
 *  CSS, instead of re-parsing the markdown of every turn. */
export function bodyStyleVars(args: {
  accent: string
  accentBg: string
  bodyFont: string
  blockBorder: string
}): Record<string, string> {
  return {
    '--sk-accent': args.accent,
    '--sk-accent-bg': args.accentBg,
    '--sk-body-font': args.bodyFont,
    '--sk-block-border': args.blockBorder,
  }
}

/** The literal var() references templates pass to `Body` so its props
 *  stay referentially stable across style-only opts changes. */
export const BODY_VAR_PROPS = {
  accent: 'var(--sk-accent)',
  accentBg: 'var(--sk-accent-bg)',
  sansFont: 'var(--sk-body-font)',
} as const

export const BODY_VAR_BLOCK_BORDER = 'var(--sk-block-border)'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

const cssRoot = resolve(import.meta.dirname, 'css')
const tokens = readFileSync(resolve(cssRoot, 'tokens.css'), 'utf8')
const styles = readFileSync(resolve(cssRoot, 'styles.css'), 'utf8')

function readHexToken(source: string, name: string) {
  const value = source.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1]
  if (!value) throw new Error(`Missing hex token ${name}`)
  return value
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }
  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))
  return (light + 0.05) / (dark + 0.05)
}

describe('shared UI CSS contract', () => {
  it('owns the canonical compact type and control dimensions', () => {
    expect(tokens).toContain('--sp-text-ui: 13px')
    expect(tokens).toContain('--sp-text-button: 12px')
    expect(tokens).toContain('--sp-text-command: 14px')
    expect(tokens).toContain('--sp-text-meta: 11px')
    expect(tokens).toContain('--sp-text-label: 10px')
    expect(tokens).toContain('--sp-text-session-title: 15px')
    expect(tokens).toContain('--sp-control-button-sm: 28px')
    expect(tokens).toContain('--sp-control-button-md: 32px')
    expect(tokens).toContain('--sp-control-button-lg: 48px')
    expect(tokens).toContain('--sp-control-icon-sm: 24px')
    expect(tokens).toContain('--sp-control-icon-md: 32px')
    expect(tokens).toContain('--sp-control-search: 36px')
    expect(tokens).toContain('--sp-control-tab: 36px')
    expect(tokens).toContain('--sp-control-nav: 32px')
    expect(tokens).toContain('--sp-motion-hover: 80ms')
    expect(tokens).toContain('--sp-shadow-popover:')
  })

  it('implements the DESIGN.md void palette for both supported dark roots', () => {
    expect(tokens).toContain('--sp-bg-light: #ffffff')
    expect(tokens).toContain('--sp-bg-dark: #000000')
    expect(tokens).toContain('--sp-bg: #ffffff')
    expect(tokens).toContain('--sp-accent: #1387ff')
    expect(tokens).toContain('--sp-accent-dm: #5bb1f0')
    expect(
      contrastRatio(readHexToken(tokens, '--sp-on-accent'), readHexToken(tokens, '--sp-accent')),
    ).toBeGreaterThanOrEqual(4.5)
    expect(tokens).toContain('html.dark,')
    expect(tokens).toContain("html[data-theme='dark']")
    expect(tokens).toContain('--sp-bg: #000000')
    expect(tokens).toContain('--sp-surface: #090909')
    expect(tokens).toContain('--sp-accent: #5bb1f0')
    const darkTokens = tokens.slice(tokens.indexOf('html.dark,'))
    expect(
      contrastRatio(
        readHexToken(darkTokens, '--sp-on-accent'),
        readHexToken(darkTokens, '--sp-accent'),
      ),
    ).toBeGreaterThanOrEqual(4.5)
    expect(tokens).not.toMatch(/Inter|#c85a00|#f07020/i)
  })

  it('keeps primitive dimensions and row spacing tied to package tokens', () => {
    expect(styles).toContain('height: var(--sp-control-button-sm)')
    expect(styles).toContain('height: var(--sp-control-button-lg)')
    expect(styles).toContain('width: var(--sp-control-icon-sm)')
    expect(styles).toContain('height: var(--sp-control-search)')
    expect(styles).toContain('height: var(--sp-control-tab)')
    expect(styles).toContain('min-height: var(--sp-control-nav)')
    expect(styles).toContain('padding: var(--sp-space-3) var(--sp-space-5)')
    expect(styles).toContain('border-radius: var(--sp-radius-badge)')
    expect(styles).toContain('border-radius: var(--sp-radius-control)')
    expect(styles).toContain('border-radius: var(--sp-radius-input)')
  })

  it('defines reusable danger, loading, and readable disabled button states', () => {
    const disabledRule = styles.match(/\.sp-button:disabled\s*\{([^}]*)\}/)?.[1] ?? ''
    const darkTokens = tokens.slice(tokens.indexOf('html.dark,'))

    expect(styles).toContain('.sp-button--danger')
    expect(styles).toContain("sp-button[data-state='loading']")
    expect(styles).toContain('animation: sp-button-spin')
    expect(disabledRule).toContain('background: var(--sp-surface)')
    expect(disabledRule).toContain('color: var(--sp-muted)')
    expect(disabledRule).not.toContain('opacity')
    expect(
      contrastRatio(readHexToken(tokens, '--sp-muted'), readHexToken(tokens, '--sp-surface')),
    ).toBeGreaterThanOrEqual(4.5)
    expect(
      contrastRatio(
        readHexToken(darkTokens, '--sp-muted'),
        readHexToken(darkTokens, '--sp-surface'),
      ),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('gives MobileMenu an explicit touch target and persistent hidden panel contract', () => {
    expect(styles).toMatch(/\.sp-mobile-menu__trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/)
    expect(styles).toMatch(/\.sp-mobile-menu__panel\s*\{[^}]*position:\s*absolute;/)
    expect(styles).toMatch(
      /\.sp-mobile-menu__panel\s*\{[^}]*box-shadow:\s*var\(--sp-shadow-popover\);/,
    )
    expect(styles).toMatch(/\.sp-mobile-menu__panel\s*\{[^}]*max-height:\s*calc\(100dvh - 72px\);/)
    expect(styles).toMatch(/\.sp-mobile-menu__panel\s*\{[^}]*overflow-y:\s*auto;/)
    expect(styles).toMatch(/\.sp-mobile-menu__panel\[hidden\]\s*\{[^}]*display:\s*none;/)
  })

  it('does not install an application reset', () => {
    expect(styles).not.toMatch(/(?:^|\n)\s*(?:html|body|\*)\s*\{/)
  })
})

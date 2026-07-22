import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

const cssRoot = resolve(import.meta.dirname, 'css')
const tokens = readFileSync(resolve(cssRoot, 'tokens.css'), 'utf8')
const styles = readFileSync(resolve(cssRoot, 'styles.css'), 'utf8')

describe('shared UI CSS contract', () => {
  it('owns the canonical compact type and control dimensions', () => {
    expect(tokens).toContain('--sp-text-ui: 13px')
    expect(tokens).toContain('--sp-text-button: 12px')
    expect(tokens).toContain('--sp-text-meta: 11px')
    expect(tokens).toContain('--sp-text-label: 10px')
    expect(tokens).toContain('--sp-text-session-title: 15px')
    expect(tokens).toContain('--sp-control-button-sm: 28px')
    expect(tokens).toContain('--sp-control-button-md: 32px')
    expect(tokens).toContain('--sp-control-icon-sm: 24px')
    expect(tokens).toContain('--sp-control-icon-md: 32px')
    expect(tokens).toContain('--sp-control-search: 36px')
    expect(tokens).toContain('--sp-control-tab: 36px')
    expect(tokens).toContain('--sp-control-nav: 32px')
    expect(tokens).toContain('--sp-motion-hover: 80ms')
  })

  it('implements the DESIGN.md void palette for both supported dark roots', () => {
    expect(tokens).toContain('--sp-bg-light: #ffffff')
    expect(tokens).toContain('--sp-bg-dark: #000000')
    expect(tokens).toContain('--sp-bg: #ffffff')
    expect(tokens).toContain('--sp-accent: #1387ff')
    expect(tokens).toContain('--sp-accent-dm: #5bb1f0')
    expect(tokens).toContain('html.dark,')
    expect(tokens).toContain("html[data-theme='dark']")
    expect(tokens).toContain('--sp-bg: #000000')
    expect(tokens).toContain('--sp-surface: #090909')
    expect(tokens).toContain('--sp-accent: #5bb1f0')
    expect(tokens).not.toMatch(/Inter|#c85a00|#f07020/i)
  })

  it('keeps primitive dimensions and row spacing tied to package tokens', () => {
    expect(styles).toContain('height: var(--sp-control-button-sm)')
    expect(styles).toContain('width: var(--sp-control-icon-sm)')
    expect(styles).toContain('height: var(--sp-control-search)')
    expect(styles).toContain('height: var(--sp-control-tab)')
    expect(styles).toContain('min-height: var(--sp-control-nav)')
    expect(styles).toContain('padding: var(--sp-space-3) var(--sp-space-5)')
    expect(styles).toContain('border-radius: var(--sp-radius-badge)')
    expect(styles).toContain('border-radius: var(--sp-radius-control)')
    expect(styles).toContain('border-radius: var(--sp-radius-input)')
  })

  it('does not install an application reset', () => {
    expect(styles).not.toMatch(/(?:^|\n)\s*(?:html|body|\*)\s*\{/)
  })
})

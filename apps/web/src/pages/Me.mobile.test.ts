import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vite-plus/test'

const css = readFileSync(new URL('../styles/me.css', import.meta.url), 'utf8')

describe('/me mobile layout contract', () => {
  it('uses a route-scoped mobile breakpoint instead of changing shared account chrome', () => {
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).toContain('.sw-main.sw-me-main')
    expect(css).toContain('.sw-card.sw-me-card')
    expect(css).toContain('.sw-modal.sw-me-modal')
  })

  it('reflows account controls and rows to minmax-safe single columns', () => {
    expect(css).toContain('grid-template-columns: auto minmax(0, 1fr)')
    expect(css).toContain("'. role role'")
    expect(css).toContain('.sw-me-card .session-feed-row')
    expect(css).toContain('.sw-me-card .sw-share')
  })

  it('keeps every /me mobile button and icon control at least 44px tall', () => {
    expect(css).toMatch(/\.sw-me-card \.sp-button,[\s\S]*?min-height: 44px/)
    expect(css).toMatch(/\.sw-me-card \.sp-icon-button[\s\S]*?min-width: 44px/)
    expect(css).toMatch(/\.sw-me-modal \.sw-modal-actions \.sp-button[\s\S]*?min-height: 44px/)
  })

  it('gives the Create team action its own full-width row at 320px', () => {
    const phoneCss = css.split('@media (max-width: 360px)')[1] ?? ''

    expect(phoneCss).toContain('.sw-me-card .sw-teams-section .sp-section-label__action')
    expect(phoneCss).toContain('grid-column: 1 / -1')
    expect(phoneCss).toMatch(/\.sw-me-card \.sw-teams-create-trigger\s*\{[^}]*width: 100%/)
  })
})

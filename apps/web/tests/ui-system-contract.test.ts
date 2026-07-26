import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

const webRoot = resolve(import.meta.dirname, '..')
const source = (path: string) => readFileSync(resolve(webRoot, path), 'utf8')
const filesUnder = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : [path]
  })

describe('Web shared UI contract', () => {
  it('loads the shared primitive stylesheet exactly once at the application root', () => {
    const imports = filesUnder(resolve(webRoot, 'src')).flatMap(
      (file) => readFileSync(file, 'utf8').match(/@spool-lab\/ui\/(?:styles|tokens)\.css/g) ?? [],
    )

    expect(imports).toEqual(['@spool-lab/ui/styles.css'])
  })

  it('allows the boot-time theme attribute without a hydration mismatch', () => {
    expect(source('src/routes/__root.tsx')).toContain('<html lang="en" suppressHydrationWarning>')
  })

  it('adapts legacy Web palette names to shared tokens instead of redeclaring the palette', () => {
    for (const file of [
      'src/styles/app.css',
      'src/styles/global.css',
      'src/styles/explore.css',
      'src/styles/workspace.css',
    ]) {
      const css = source(file)
      expect(css, file).toContain('--bg: var(--sp-bg)')
      expect(css, file).toContain('--accent: var(--sp-accent)')
      expect(css, file).not.toMatch(
        /#(?:fafaf8|f4f4f0|eeeee9|e8e8e2|d8d8d0|1c1c18|6b6b60|adadaa|c85a00|fff3e8|141410|242420|2e2e28|3a3a34|f2f2ec|8a8a80|505048|f07020|2a1800)\b/i,
      )
    }
  })

  it('keeps Explore desktop chrome compact and reserves 44px targets for adaptations', () => {
    const css = source('src/styles/explore.css')
    const desktopCss = css.split('@media (max-width: 768px)')[0] ?? ''
    const mobileCss = (css.split('@media (max-width: 768px)')[1] ?? '').split(
      '@media (max-width: 480px)',
    )[0]
    const coarsePointerCss = (css.split('@media (pointer: coarse)')[1] ?? '').split(
      '@media (prefers-reduced-motion: reduce)',
    )[0]

    expect(desktopCss).not.toMatch(/(?:width|height|min-width|min-height):\s*(?:44|48)px/)
    expect(mobileCss).toMatch(/min-height:\s*44px/)
    expect(coarsePointerCss).toMatch(/min-width:\s*44px/)
    expect(coarsePointerCss).toMatch(/min-height:\s*44px/)
  })

  it('uses shared large/loading buttons beside 48px Team form controls', () => {
    const css = source('src/styles/app.css')
    const desktopCss = css.split('@media (max-width: 768px)')[0] ?? ''
    const teamPage = source('src/pages/Team.tsx')

    expect(desktopCss).toMatch(
      /\.sw-team-invite input,\s*\.sw-team-invite select,[^{]*\{[^}]*height:\s*var\(--sp-control-button-lg\);[^}]*\}/,
    )
    expect(desktopCss).not.toMatch(
      /\.sw-team-invite-controls \.sp-button\s*\{[^}]*height:\s*48px;[^}]*\}/,
    )
    expect(teamPage.match(/size="lg"/g)).toHaveLength(3)
    expect(teamPage).toContain("loading={busyKey === 'invite'}")
    expect(teamPage).toContain("loading={busy === 'rename'}")
    expect(teamPage).toContain("loading={busy === 'handle'}")
  })

  it('uses the shared danger hierarchy instead of private Team color patches', () => {
    const teamPage = source('src/pages/Team.tsx')
    const managedSessions = source('src/components/ManagedSessionList.tsx')
    const css = source('src/styles/app.css')

    expect(teamPage.match(/variant="danger"/g)?.length).toBeGreaterThanOrEqual(4)
    expect(managedSessions).toContain('variant="danger"')
    expect(css).not.toContain('.sw-team-danger-button')
  })

  it('keeps semantic card widths out of Tailwind numeric utility names', () => {
    const appSource = filesUnder(resolve(webRoot, 'src'))
      .filter((file) => /\.(?:ts|tsx|css)$/.test(file))
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n')

    // Tailwind interprets `w-600` as a generated width utility and marks it
    // important, which overrides the responsive `width: 100%` card rule.
    expect(appSource).not.toMatch(/\bw-(?:420|480|600)\b/)
    expect(source('src/styles/app.css')).toContain('.sw-card.sw-card--600')
  })

  it('keeps public and product navigation reachable with mobile-size targets', () => {
    const appCss = source('src/styles/app.css')
    const appMobile = appCss.split('@media (max-width: 768px)')[1] ?? ''
    const siteCss = source('src/styles/global.css')
    const siteMobile = siteCss.split('@media (max-width: 768px)')[1] ?? ''
    const workspaceCss = source('src/styles/workspace.css')
    const workspaceMobile = workspaceCss.split('@media (max-width: 768px)')[1] ?? ''

    expect(appCss).toMatch(
      /\.sw-header-mobile-menu-items \.sp-nav-item,[^{]*\{[^}]*min-height:\s*44px;/,
    )
    expect(appMobile).toMatch(/\.sw-header-nav\s*\{[^}]*display:\s*none;/)
    expect(appMobile).toMatch(
      /\.sp-mobile-menu\.sw-header-mobile-menu\s*\{[^}]*display:\s*inline-flex;/,
    )
    expect(appMobile).toMatch(/\.sw-signin-link\s*\{[^}]*min-height:\s*44px;/)

    expect(siteMobile).toMatch(/\.site-main-nav\s*\{[^}]*display:\s*none;/)
    expect(siteCss).toMatch(
      /\.site-mobile-menu-items \.sp-nav-item,[^{]*\{[^}]*min-height:\s*44px;/,
    )
    expect(siteMobile).toMatch(
      /\.sp-mobile-menu\.site-mobile-menu\s*\{[^}]*display:\s*inline-flex;/,
    )
    expect(siteMobile).toMatch(/\.site-signin-link\s*\{[^}]*min-height:\s*44px;/)
    expect(siteMobile).toMatch(/\.brand\s*\{[^}]*min-height:\s*44px;/)

    // The avatar-anchored account menu replaced the old per-header account
    // links; its trigger and rows keep the 44px phone/compact targets.
    const accountMenuCss = source('src/styles/account-menu.css')
    const accountMenuMobile = accountMenuCss.split('@media (max-width: 768px)')[1] ?? ''
    expect(accountMenuMobile).toMatch(
      /\.account-menu-trigger\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/,
    )
    expect(accountMenuMobile).toMatch(/\.account-menu-item\s*\{[^}]*min-height:\s*44px;/)

    expect(workspaceMobile).toMatch(/\.workspace-mobile-menu\s*\{[^}]*display:\s*inline-flex;/)
    expect(workspaceMobile).toMatch(
      /\.workspace-mobile-menu-primary \.sp-nav-item,[^{]*\{[^}]*min-height:\s*44px;/,
    )
    expect(workspaceCss).not.toContain('.workspace-mobile-account')
    expect(workspaceCss).not.toContain('@media (max-width: 980px)')
  })

  it('contains long or numerous Session scope tabs inside the viewport', () => {
    const exploreCss = source('src/styles/explore.css')
    const exploreMobile = exploreCss.split('@media (max-width: 768px)')[1] ?? ''

    expect(exploreCss).toMatch(
      /\.sessions-scope-tabs\s*\{[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/,
    )
    expect(exploreCss).toMatch(
      /\.sessions-scope-tabs \.sp-tabs__tab\s*\{[^}]*flex:\s*0 0 auto;[^}]*max-width:\s*min\(280px,\s*calc\(100vw - var\(--sp-space-8\)\)\);[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/,
    )
    expect(exploreMobile).toMatch(
      /\.sessions-scope-tabs \.sp-tabs__tab,[^{]*\{[^}]*min-height:\s*44px;/,
    )
  })
})

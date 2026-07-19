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
    for (const file of ['src/styles/app.css', 'src/styles/global.css', 'src/styles/explore.css']) {
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
    const desktopCss = css.split('@media (max-width: 760px)')[0] ?? ''
    const mobileCss = (css.split('@media (max-width: 760px)')[1] ?? '').split(
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
})

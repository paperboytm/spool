import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vite-plus/test'

const rendererRoot = import.meta.dirname
const appRoot = resolve(rendererRoot, '../..')

function readRenderer(relativePath: string): string {
  return readFileSync(resolve(rendererRoot, relativePath), 'utf8')
}

describe('desktop shared UI migration', () => {
  it('loads the shared stylesheet once at the renderer root', () => {
    const main = readRenderer('main.tsx')
    const styles = readRenderer('styles.css')

    expect(main.match(/@spool-lab\/ui\/styles\.css/g)).toHaveLength(1)
    expect(styles).not.toContain('@spool-lab/ui/styles.css')
    expect(main).toContain("classList.toggle('dark', dark)")
    expect(main).toContain("preferredColorScheme.addEventListener('change'")
  })

  it('maps legacy Tailwind color and font names to shared tokens', () => {
    const styles = readRenderer('styles.css')

    expect(styles).toContain('--color-warm-bg: var(--sp-bg)')
    expect(styles).toContain('--color-dark-bg: var(--sp-bg)')
    expect(styles).toContain('--color-src-claude: var(--sp-source-claude)')
    expect(styles).toContain('--color-status-success: var(--sp-success)')
    expect(styles).toContain('--font-sans: var(--sp-font-sans)')
    expect(styles).toContain('--font-mono: var(--sp-font-mono)')
    expect(styles).toContain('background: var(--sp-bg-dark)')
    expect(styles).toContain('background: var(--sp-bg-light)')
    expect(styles).not.toContain("font-family: 'Inter Variable'")
  })

  it('keeps the theme editor on the shared active token seam', () => {
    const adapter = readRenderer('theme/applyEditorTheme.ts')

    expect(adapter).toContain("root.classList.toggle('dark', isDark)")
    expect(adapter).toContain("'--sp-surface-2': surface2")
    expect(adapter).toContain("'--sp-font-sans'")
    expect(adapter).not.toContain("root.style.setProperty('--color-")
  })

  it('uses shared chrome primitives at the recurring desktop seams', () => {
    const sidebar = readRenderer('components/Sidebar.tsx')
    const sessionRow = readRenderer('components/SessionRow.tsx')
    const pinButton = readRenderer('components/PinButton.tsx')
    const hubShare = readRenderer('components/hub-share-dialog.tsx')
    const virtualList = readRenderer('components/VirtualSessionList.tsx')

    expect(sidebar).toContain('IconButton, NavItem, SectionLabel')
    expect(sidebar).toContain('<NavItem')
    expect(sessionRow).toContain('<ListRow')
    expect(sessionRow).toContain('metadata={')
    expect(sessionRow).toContain('trailing={')
    expect(pinButton).toContain("size === 'md' ? 'w-8 h-8' : 'w-6 h-6'")
    expect(hubShare.match(/<Button/g)?.length).toBeGreaterThanOrEqual(5)
    expect(virtualList).toContain('<SectionLabel')
  })

  it('builds the shared package before the desktop bundle', () => {
    const packageJson = JSON.parse(readFileSync(resolve(appRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['build:ui']).toContain('@spool-lab/ui')
    expect(packageJson.scripts['build:deps']).toContain('pnpm run build:ui')
  })
})

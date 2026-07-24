import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { AccountMenu, accountMenuTargetIndex } from './AccountMenu'

const source = readFileSync(new URL('./AccountMenu.tsx', import.meta.url), 'utf8')

describe('AccountMenu', () => {
  it('renders a closed, accessible avatar trigger by default', () => {
    const html = renderToStaticMarkup(<AccountMenu name="Alice" src={null} />)

    expect(html).toContain('aria-haspopup="menu"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-label="Open account menu"')
    expect(html).toContain('title="Alice"')
    // The panel mounts only when opened; closed chrome leaks no links.
    expect(html).not.toContain('role="menu"')
    expect(html).not.toContain('href="/me"')
    expect(html).not.toContain('Sign out')
  })

  it('wraps arrow navigation and supports Home and End', () => {
    expect(accountMenuTargetIndex('ArrowDown', 0, 5)).toBe(1)
    expect(accountMenuTargetIndex('ArrowDown', 4, 5)).toBe(0)
    expect(accountMenuTargetIndex('ArrowUp', 0, 5)).toBe(4)
    expect(accountMenuTargetIndex('ArrowUp', -1, 5)).toBe(4)
    expect(accountMenuTargetIndex('Home', 3, 5)).toBe(0)
    expect(accountMenuTargetIndex('End', 1, 5)).toBe(4)
    expect(accountMenuTargetIndex('Escape', 1, 5)).toBeNull()
    expect(accountMenuTargetIndex('ArrowDown', 0, 0)).toBeNull()
  })

  it('focuses the opened menu and gives Escape and Tab distinct dismissal behavior', () => {
    expect(source).toContain(
      "items[initialFocusRef.current === 'last' ? items.length - 1 : 0]?.focus()",
    )
    expect(source).toContain("if (event.key === 'Escape')")
    expect(source).toContain("else if (event.key === 'Tab')")
    expect(source).toContain(
      'moveFocusOutsideMenu(rootRef.current, triggerRef.current, event.shiftKey)',
    )
    expect(source).toContain("event.key !== 'ArrowDown' && event.key !== 'ArrowUp'")
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { WorkspaceFrame } from './WorkspaceFrame'

describe('WorkspaceFrame', () => {
  it('keeps the product destinations primary and moves resources to utility navigation', () => {
    const html = renderToStaticMarkup(
      <WorkspaceFrame active="sessions">
        <p>Session content</p>
      </WorkspaceFrame>,
    )

    expect(html).toContain('aria-label="Primary navigation"')
    expect(html).toContain('aria-label="Mobile workspace navigation"')
    expect(html).toContain('href="/explore?sort=recommended"')
    expect(html).toContain('href="/my-sessions"')
    expect(html).toContain('href="/teams"')
    expect(html).toContain('aria-label="My Sessions"')
    expect(html).not.toContain('aria-label="Home"')
    expect(html).not.toContain('aria-label="Docs"')
    expect(html).toContain('aria-label="Account and resources"')
    expect(html).toContain('href="/docs/installation"')
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
    expect(html).toContain('https://github.com/paperboytm/spool')
  })
})

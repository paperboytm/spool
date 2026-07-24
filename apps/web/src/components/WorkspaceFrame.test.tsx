import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { WorkspaceFrame, WorkspaceMobileHeader } from './WorkspaceFrame'

describe('WorkspaceFrame', () => {
  it('keeps the product destinations primary and moves resources to utility navigation', () => {
    const html = renderToStaticMarkup(
      <WorkspaceFrame active="library">
        <p>Session content</p>
      </WorkspaceFrame>,
    )

    expect(html).toContain('aria-label="Primary navigation"')
    expect(html).toContain('aria-label="Mobile workspace navigation"')
    expect(html).toContain('href="/sessions"')
    expect(html).toContain('aria-label="Sessions"')
    expect(html).not.toContain('href="/explore')
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

  it('uses the shared account menu for the signed-in mobile identity affordance', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMobileHeader active="feed" identity={{ name: 'Alice', src: null }} />,
    )

    expect(html).toContain('aria-label="Open account menu"')
    expect(html).toContain('aria-haspopup="menu"')
    expect(html).not.toContain('class="workspace-mobile-account"')
    expect(html).not.toContain('aria-label="Open your account"')
  })
})

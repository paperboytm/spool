import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { WorkspaceFrame, WorkspaceMobileHeader, WorkspacePrimaryNavigation } from './WorkspaceFrame'

describe('WorkspaceFrame', () => {
  it('keeps the product destinations primary and moves resources to utility navigation', () => {
    const html = renderToStaticMarkup(
      <WorkspaceFrame active="library">
        <p>Session content</p>
      </WorkspaceFrame>,
    )

    expect(html).toContain('aria-label="Primary navigation"')
    expect(html).toContain('aria-label="Mobile workspace navigation"')
    expect(html).toMatch(/class="workspace-wordmark" href="\/"/)
    expect(html).toContain('aria-label="Spool home"')
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

  it('reveals confirmed Team memberships directly below the Teams disclosure', () => {
    const html = renderToStaticMarkup(
      <WorkspacePrimaryNavigation
        active="teams"
        activeTeamId="team/a"
        className="test-navigation"
        label="Test navigation"
        teams={[
          {
            id: 'team/a',
            name: 'Paperboy',
            role: 'owner',
            permissions: ['team:update'],
          },
          {
            id: 'team-b',
            name: 'Design systems',
            role: 'member',
            permissions: [],
          },
        ]}
        teamsConfirmed
      />,
    )

    expect(html).toContain('aria-label="Teams"')
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('href="/teams/team%2Fa"')
    expect(html).toContain('href="/teams/team-b"')
    expect(html).toContain('Paperboy')
    expect(html).toContain('Design systems')
    expect(html).toContain('Create team')
  })

  it('does not expose unconfirmed Team names in workspace navigation', () => {
    const html = renderToStaticMarkup(
      <WorkspacePrimaryNavigation
        active="feed"
        className="test-navigation"
        label="Test navigation"
        teams={[]}
        teamsConfirmed={false}
      />,
    )

    expect(html).toContain('aria-label="Teams"')
    expect(html).toContain('href="/teams"')
    expect(html).not.toContain('Create team')
    expect(html).not.toContain('workspace-team-navigation-items')
  })

  it('keeps Team creation reachable when the confirmed membership list is empty', () => {
    const html = renderToStaticMarkup(
      <WorkspacePrimaryNavigation
        active="teams"
        className="test-navigation"
        label="Test navigation"
        teams={[]}
        teamsConfirmed
      />,
    )

    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('href="/teams"')
    expect(html).toContain('Create team')
  })
})

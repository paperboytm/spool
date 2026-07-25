import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { parseSessionsSearch } from '../lib/discovery'
import { scopeSearchForTab, scopeTabValue, SessionsPage } from './Sessions'

describe('sessions search parsing', () => {
  it('defaults to the public scope and drops the retired Agent filter', () => {
    expect(parseSessionsSearch({ q: ' token  races ', sort: 'recent', agent: 'codex' })).toEqual({
      q: 'token races',
      sort: 'recent',
    })
  })

  it('accepts mine and team scopes, rejecting malformed team ids', () => {
    expect(parseSessionsSearch({ scope: 'mine', q: 'ignored' })).toEqual({
      sort: 'recent',
      scope: 'mine',
    })
    expect(parseSessionsSearch({ scope: 'team', team: 'team_123', sort: 'recommended' })).toEqual({
      sort: 'recent',
      scope: 'team',
      team: 'team_123',
    })
    // Team scope without a valid tenant id settles on the public feed.
    expect(parseSessionsSearch({ scope: 'team' })).toEqual({ sort: 'recommended' })
    expect(parseSessionsSearch({ scope: 'team', team: 'a b/c' })).toEqual({ sort: 'recommended' })
    expect(parseSessionsSearch({ scope: 'everything' })).toEqual({ sort: 'recommended' })
  })
})

describe('scope tab mapping', () => {
  it('round-trips scope state through tab values', () => {
    expect(scopeTabValue({ sort: 'recommended' })).toBe('public')
    expect(scopeTabValue({ sort: 'recommended', scope: 'mine' })).toBe('mine')
    expect(scopeTabValue({ sort: 'recommended', scope: 'team', team: 't1' })).toBe('team:t1')

    expect(scopeSearchForTab('public')).toEqual({ sort: 'recommended' })
    expect(scopeSearchForTab('mine')).toEqual({ sort: 'recent', scope: 'mine' })
    expect(scopeSearchForTab('team:t1')).toEqual({
      sort: 'recent',
      scope: 'team',
      team: 't1',
    })
  })
})

describe('SessionsPage', () => {
  it('renders the public feed inside the workspace navigation', () => {
    const html = renderToStaticMarkup(
      <SessionsPage search={{ sort: 'recommended' }} onSearchChange={() => {}} />,
    )

    for (const label of ['Sessions', 'My Sessions', 'Teams']) {
      expect(html).toContain(`aria-label="${label}"`)
    }
    expect(html).toContain('id="explore-results"')
    expect(html).toContain('href="/sessions"')
    expect(html).not.toContain('href="/explore')
  })

  it('hides the scope switcher until membership is confirmed by the server', () => {
    // Static render never resolves /api/teams, which is exactly the
    // signed-out / unknown case: no Team names may leak from navigation
    // state alone.
    const html = renderToStaticMarkup(
      <SessionsPage search={{ sort: 'recommended' }} onSearchChange={() => {}} />,
    )
    expect(html).not.toContain('aria-label="Session scope"')
  })

  it('answers unknown team scopes with the same unavailable treatment', () => {
    const html = renderToStaticMarkup(
      <SessionsPage
        search={{ sort: 'recommended', scope: 'team', team: 'team_x' }}
        onSearchChange={() => {}}
      />,
    )
    expect(html).toContain('Checking your Team access…')
    expect(html).not.toContain('team_x')
    expect(html).not.toContain('id="explore-results"')
  })
})

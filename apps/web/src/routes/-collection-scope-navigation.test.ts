import { describe, expect, it } from 'vite-plus/test'

import {
  projectsSearchHref,
  requiresPrivateDocumentReload as projectsRequireReload,
} from './projects.index'
import {
  requiresPrivateDocumentReload as sessionsRequireReload,
  sessionsSearchHref,
} from './sessions'

describe('private collection scope navigation', () => {
  it('reloads when a Public document starts rendering personal or Team Sessions', () => {
    expect(
      sessionsRequireReload(
        { sort: 'recommended' },
        { sort: 'recent', scope: 'team', team: 'team_123' },
      ),
    ).toBe(true)
    expect(
      sessionsRequireReload(
        { sort: 'recent', scope: 'mine' },
        { sort: 'recent', scope: 'team', team: 'team_123' },
      ),
    ).toBe(false)
    expect(sessionsSearchHref({ sort: 'recent', scope: 'mine' })).toBe(
      '/sessions?sort=recent&scope=mine',
    )
  })

  it('reloads when a Public document starts rendering personal or Team Projects', () => {
    expect(projectsRequireReload({ scope: 'public' }, { scope: 'mine' })).toBe(true)
    expect(projectsRequireReload({ scope: 'public' }, { scope: 'starred' })).toBe(true)
    expect(projectsRequireReload({ scope: 'starred' }, { scope: 'watching' })).toBe(false)
    expect(projectsRequireReload({ scope: 'mine' }, { scope: 'team', team: 'team_123' })).toBe(
      false,
    )
    expect(projectsSearchHref({ scope: 'team', team: 'team_123' })).toBe(
      '/projects?scope=team&team=team_123',
    )
    expect(projectsSearchHref({ scope: 'watching' })).toBe('/projects?scope=watching')
  })
})

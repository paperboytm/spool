import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { projectEmptyStateCopy, ProjectPage } from './Project'
import { appendUniqueProjects, ProjectsPage } from './Projects'

describe('ProjectsPage', () => {
  it('makes Projects a first-class destination without a page-global language switch', () => {
    const html = renderToStaticMarkup(
      <ProjectsPage search={{ scope: 'public' }} onSearchChange={() => undefined} />,
    )

    expect(html).toContain('aria-label="Projects"')
    expect(html).toContain('aria-label="Project scope"')
    expect(html).toContain('>Public</')
    expect(html).toContain('Loading Projects')
    expect(html).not.toContain('aria-label="Session language"')
  })

  it('appends cursor pages without duplicating Projects', () => {
    const owner = { kind: 'user' as const, id: 'user_1', handle: 'evan', name: 'Evan' }
    const project = {
      id: 'project_1',
      slug: 'spool',
      name: 'Spool',
      description: null,
      github_url: null,
      owner,
      session_count: 1,
      updated_at: 1,
      archived_at: null,
      can_manage: false,
    }

    expect(
      appendUniqueProjects(
        [project],
        [
          project,
          { ...project, id: 'project_2', slug: 'react-vapor', name: 'React Vapor' },
          { ...project, id: 'project_2', slug: 'duplicate', name: 'Duplicate' },
        ],
      ).map((value) => value.id),
    ).toEqual(['project_1', 'project_2'])
  })
})

describe('ProjectPage', () => {
  it('does not show an ineffective language switch before Project Sessions load', () => {
    const html = renderToStaticMarkup(<ProjectPage handle="evan" slug="react-vapor" />)

    expect(html).toContain('href="/projects"')
    expect(html).not.toContain('aria-label="Session language"')
  })

  it('keeps the canonical empty personal Project in a real reader empty state', () => {
    expect(projectEmptyStateCopy(false)).toEqual({
      heading: 'No Public Sessions in this Project yet',
      detail: 'Sessions appear here after their author associates them from the Spool CLI.',
    })
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import type { ProjectSummary } from '../lib/project-api'
import { ProjectCard, projectHref } from './ProjectCard'
import { slugifyProjectName } from './ProjectForm'

function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: 'project_1',
    slug: 'react-vapor',
    name: 'React Vapor',
    description: 'Make fine-grained DOM updates available to ordinary React code.',
    github_url: 'https://github.com/paperboytm/react-vapor',
    owner: {
      kind: 'user',
      id: 'user_1',
      handle: 'evan',
      name: 'Evan',
    },
    session_count: 2,
    updated_at: 1,
    archived_at: null,
    can_manage: true,
    ...overrides,
  }
}

describe('ProjectCard', () => {
  it('uses the canonical owner/project path and keeps GitHub secondary', () => {
    const value = project()
    const html = renderToStaticMarkup(<ProjectCard project={value} />)

    expect(projectHref(value)).toBe('/@evan/react-vapor')
    expect(html).toContain('href="/@evan/react-vapor"')
    expect(html).toContain('<h2>React Vapor</h2>')
    expect(html).toContain('@evan')
    expect(html).toContain('react-vapor')
    expect(html).toContain('2 Sessions')
    expect(html).toContain('href="https://github.com/paperboytm/react-vapor"')
    expect(html).toContain('href="/projects/project_1/edit"')
    expect(html).not.toContain('>Team</')
  })

  it('marks Team Projects as private tenant content', () => {
    const html = renderToStaticMarkup(
      <ProjectCard
        project={project({
          owner: {
            kind: 'team',
            id: 'team_1',
            handle: 'paperboy',
            name: 'Paperboy',
          },
        })}
      />,
    )

    expect(html).toContain('href="/@paperboy/react-vapor"')
    expect(html).toContain('href="/projects/project_1/edit?team=team_1"')
    expect(html).toContain('Team')
  })
})

describe('slugifyProjectName', () => {
  it('produces a stable GitHub-like slug without an invalid trailing dash', () => {
    expect(slugifyProjectName(' React Vapor / Compiler ')).toBe('react-vapor-compiler')
    expect(slugifyProjectName(`${'a'.repeat(63)} -- tail`)).toMatch(
      /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    )
  })
})

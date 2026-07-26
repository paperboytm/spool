import { createFileRoute } from '@tanstack/react-router'

import { ProjectsPage, type ProjectsSearchState } from '../pages/Projects'

function parseProjectsSearch(value: Record<string, unknown>): ProjectsSearchState {
  if (value['scope'] === 'mine') return { scope: 'mine' }
  if (value['scope'] === 'starred') return { scope: 'starred' }
  if (value['scope'] === 'watching') return { scope: 'watching' }
  if (
    value['scope'] === 'team' &&
    typeof value['team'] === 'string' &&
    /^[0-9A-Za-z_-]{8,128}$/.test(value['team'])
  ) {
    return { scope: 'team', team: value['team'] }
  }
  return { scope: 'public' }
}

export const Route = createFileRoute('/projects/')({
  validateSearch: parseProjectsSearch,
  head: () => ({
    meta: [
      { title: 'Projects · Spool' },
      {
        name: 'description',
        content: 'Browse Projects that give related agent Sessions one durable home.',
      },
    ],
  }),
  component: ProjectsRoute,
})

function ProjectsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ProjectsPage
      search={search}
      onSearchChange={(next) => {
        if (requiresPrivateDocumentReload(search, next)) {
          window.location.assign(projectsSearchHref(next))
          return
        }
        void navigate({ search: next })
      }}
    />
  )
}

export function requiresPrivateDocumentReload(
  current: ProjectsSearchState,
  next: ProjectsSearchState,
): boolean {
  return !isPrivateProjectsScope(current) && isPrivateProjectsScope(next)
}

export function projectsSearchHref(search: ProjectsSearchState): string {
  const params = new URLSearchParams()
  if (search.scope === 'mine') {
    params.set('scope', 'mine')
  } else if (search.scope === 'starred') {
    params.set('scope', 'starred')
  } else if (search.scope === 'watching') {
    params.set('scope', 'watching')
  } else if (search.scope === 'team') {
    params.set('scope', 'team')
    params.set('team', search.team)
  }
  const query = params.toString()
  return query ? `/projects?${query}` : '/projects'
}

function isPrivateProjectsScope(search: ProjectsSearchState): boolean {
  return (
    search.scope === 'mine' ||
    search.scope === 'starred' ||
    search.scope === 'watching' ||
    search.scope === 'team'
  )
}

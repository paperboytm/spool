import { createFileRoute } from '@tanstack/react-router'

import { NewProjectPage } from '../pages/ProjectEditor'

function parseNewProjectSearch(value: Record<string, unknown>): { team?: string } {
  const team = value['team']
  return typeof team === 'string' && /^[0-9A-Za-z_-]{8,128}$/.test(team) ? { team } : {}
}

export const Route = createFileRoute('/projects/new')({
  ssr: false,
  validateSearch: parseNewProjectSearch,
  head: () => ({
    meta: [
      { title: 'New Project · spool.new' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
  }),
  component: NewProjectRoute,
})

function NewProjectRoute() {
  const { team } = Route.useSearch()
  return <NewProjectPage {...(team ? { teamId: team } : {})} />
}

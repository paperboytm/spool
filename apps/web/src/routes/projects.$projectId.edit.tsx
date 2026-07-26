import { createFileRoute } from '@tanstack/react-router'

import { EditProjectPage } from '../pages/ProjectEditor'

function parseEditProjectSearch(value: Record<string, unknown>): { team?: string } {
  const team = value['team']
  return typeof team === 'string' && /^[0-9A-Za-z_-]{8,128}$/.test(team) ? { team } : {}
}

export const Route = createFileRoute('/projects/$projectId/edit')({
  ssr: false,
  validateSearch: parseEditProjectSearch,
  head: () => ({
    meta: [
      { title: 'Edit Project · spool.new' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
  }),
  component: EditProjectRoute,
})

function EditProjectRoute() {
  const { projectId } = Route.useParams()
  const { team } = Route.useSearch()
  return <EditProjectPage projectId={projectId} {...(team ? { teamId: team } : {})} />
}

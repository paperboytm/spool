import { createFileRoute } from '@tanstack/react-router'

import { TeamPage, type TeamTab } from '../pages/Team'

export type TeamSearch = { section?: Exclude<TeamTab, 'sessions'> }

export function parseTeamSearch(value: Record<string, unknown>): TeamSearch {
  const section = value['section']
  return section === 'projects' || section === 'members' || section === 'settings'
    ? { section }
    : {}
}

export function privateTeamHead() {
  return {
    meta: [
      { title: 'Team · spool.new' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
  }
}

export const Route = createFileRoute('/teams/$teamId')({
  ssr: false,
  validateSearch: parseTeamSearch,
  // Team workspaces are authenticated tenant surfaces. Keep the response
  // metadata generic and explicitly prevent indexing/previews from treating a
  // Team URL as public content, even before the client-side membership check
  // runs.
  head: privateTeamHead,
  component: TeamRoute,
})

function TeamRoute() {
  const { teamId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const tab: TeamTab = search.section ?? 'sessions'
  // Route params can change without remounting the route component. Key the
  // workspace by its immutable tenant id so an older Team request cannot win a
  // race and paint actionable Team A state under Team B's URL.
  return (
    <TeamPage
      key={teamId}
      teamId={teamId}
      tab={tab}
      onTabChange={(section) => {
        void navigate({
          search: section === 'sessions' ? {} : { section },
        })
      }}
    />
  )
}

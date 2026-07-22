import { createFileRoute } from '@tanstack/react-router'

import { TeamPage } from '../pages/Team'

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
  // Team workspaces are authenticated tenant surfaces. Keep the response
  // metadata generic and explicitly prevent indexing/previews from treating a
  // Team URL as public content, even before the client-side membership check
  // runs.
  head: privateTeamHead,
  component: TeamRoute,
})

function TeamRoute() {
  const { teamId } = Route.useParams()
  // Route params can change without remounting the route component. Key the
  // workspace by its immutable tenant id so an older Team request cannot win a
  // race and paint actionable Team A state under Team B's URL.
  return <TeamPage key={teamId} teamId={teamId} />
}

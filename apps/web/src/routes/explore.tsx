import { createFileRoute } from '@tanstack/react-router'

import { parseExploreSearch, type ExploreSearchState } from '../lib/discovery'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'
import { ExplorePage } from '../pages/Explore'

import '../styles/explore.css'

export const Route = createFileRoute('/explore')({
  validateSearch: parseExploreSearch,
  head: () => ({
    meta: [
      { title: 'Explore agent Sessions · Spool' },
      {
        name: 'description',
        content: 'Find public Claude Code and Codex CLI Sessions with summaries and evidence.',
      },
    ],
    links: [{ rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/explore` }],
  }),
  component: ExploreRoute,
})

function ExploreRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <ExplorePage
      search={search}
      onSearchChange={(next: ExploreSearchState) => {
        void navigate({ search: next })
      }}
    />
  )
}

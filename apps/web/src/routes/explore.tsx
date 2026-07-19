import { createFileRoute } from '@tanstack/react-router'

import { parseExploreSearch, type ExploreSearchState } from '../lib/discovery'
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
    links: [{ rel: 'canonical', href: 'https://spool.pro/explore' }],
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

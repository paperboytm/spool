import { createFileRoute } from '@tanstack/react-router'

import { parseSessionsSearch, type SessionsSearchState } from '../lib/discovery'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'
import { SessionsPage } from '../pages/Sessions'

import '../styles/explore.css'

export const Route = createFileRoute('/sessions')({
  validateSearch: parseSessionsSearch,
  head: () => ({
    meta: [
      { title: 'Sessions · Spool' },
      {
        name: 'description',
        content:
          'One feed for agent Sessions: browse public Claude Code and Codex CLI work, your Teams, and your own uploads.',
      },
    ],
    links: [{ rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/sessions` }],
  }),
  component: SessionsRoute,
})

function SessionsRoute() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <SessionsPage
      search={search}
      onSearchChange={(next: SessionsSearchState) => {
        void navigate({ search: next })
      }}
    />
  )
}

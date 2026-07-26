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
        if (requiresPrivateDocumentReload(search, next)) {
          window.location.assign(sessionsSearchHref(next))
          return
        }
        void navigate({ search: next })
      }}
    />
  )
}

export function requiresPrivateDocumentReload(
  current: SessionsSearchState,
  next: SessionsSearchState,
): boolean {
  return !isPrivateSessionsScope(current) && isPrivateSessionsScope(next)
}

export function sessionsSearchHref(search: SessionsSearchState): string {
  const params = new URLSearchParams()
  params.set('sort', search.sort)
  if (search.scope === 'mine') {
    params.set('scope', 'mine')
  } else if (search.scope === 'team' && search.team) {
    params.set('scope', 'team')
    params.set('team', search.team)
  }
  return `/sessions?${params.toString()}`
}

function isPrivateSessionsScope(search: SessionsSearchState): boolean {
  return search.scope === 'mine' || search.scope === 'team'
}

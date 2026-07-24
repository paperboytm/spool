import { createFileRoute, redirect } from '@tanstack/react-router'

import { parseExploreSearch } from '../lib/discovery'

/**
 * `/explore` moved into the unified `/sessions` feed. The route stays as a
 * compatibility redirect because published links, docs, and old OG cards
 * still point here; Discovery filters carry over unchanged.
 */
export const Route = createFileRoute('/explore')({
  validateSearch: parseExploreSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/sessions', search, replace: true })
  },
})

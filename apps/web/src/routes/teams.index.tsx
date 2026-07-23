import { createFileRoute } from '@tanstack/react-router'

import { TeamsPage } from '../pages/Teams'

export const Route = createFileRoute('/teams/')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'Teams · spool.new' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
  }),
  component: TeamsPage,
})

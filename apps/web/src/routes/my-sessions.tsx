import { createFileRoute } from '@tanstack/react-router'

import { MySessionsPage } from '../pages/MySessions'

export const Route = createFileRoute('/my-sessions')({
  ssr: false,
  head: () => ({
    meta: [
      { title: 'My Sessions · spool.new' },
      { name: 'robots', content: 'noindex, nofollow, noarchive' },
    ],
  }),
  component: MySessionsPage,
})

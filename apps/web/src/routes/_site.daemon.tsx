import { createFileRoute } from '@tanstack/react-router'

import DaemonPage from '../components/site/daemon'
import { PUBLIC_SITE_ORIGIN } from '../lib/site'

const TITLE = 'Spool Daemon — Background sync for your captures'
const DESC =
  'A standalone app that quietly pulls your stars, bookmarks, saves and notes into a local SQLite database. Search captures from its own UI, or pair with Spool. Plugins for the platforms you care about. Nothing leaves the machine.'

export const Route = createFileRoute('/_site/daemon')({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: 'description', content: DESC },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: `${PUBLIC_SITE_ORIGIN}/daemon` },
      { property: 'og:title', content: TITLE },
      { property: 'og:description', content: DESC },
      { property: 'og:image', content: `${PUBLIC_SITE_ORIGIN}/og-image.png` },
      { property: 'og:site_name', content: 'Spool' },
    ],
    links: [{ rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/daemon` }],
  }),
  component: DaemonPage,
})

import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'

import { PUBLIC_SITE_ORIGIN } from '../lib/site'

export const Route = createFileRoute('/_site/connectors')({
  head: () => ({
    meta: [{ title: 'Redirecting to /daemon' }, { name: 'robots', content: 'noindex' }],
    links: [{ rel: 'canonical', href: `${PUBLIC_SITE_ORIGIN}/daemon` }],
  }),
  component: ConnectorsRedirect,
})

function ConnectorsRedirect() {
  useEffect(() => {
    window.location.replace('/daemon')
  }, [])
  return (
    <main className="wrap px-6 py-24 text-center">
      <p className="text-reading text-muted">
        Connectors moved. Redirecting to{' '}
        <a href="/daemon" className="text-accent">
          /daemon
        </a>
        …
      </p>
    </main>
  )
}

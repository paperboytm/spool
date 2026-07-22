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
    <main className="wrap" style={{ padding: '120px 24px', textAlign: 'center' }}>
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>
        Connectors moved. Redirecting to{' '}
        <a href="/daemon" style={{ color: 'var(--accent)' }}>
          /daemon
        </a>
        …
      </p>
    </main>
  )
}

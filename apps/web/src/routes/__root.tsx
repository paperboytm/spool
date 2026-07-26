import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import '../styles/tailwind.css'
// Self-hosted Geist (CSP: font-src 'self'). The variable face carries
// the sans family for both surfaces; mono weights match what the
// indexed-content styles use. Loaded at the root so the marketing and
// app surfaces share one font pipeline — the old landing site pulled
// Google Fonts, which the reader CSP would block.
import '@fontsource-variable/geist/index.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource/geist-mono/600.css'

import { Tombstone } from '../pages/Tombstone'

// Boot-time theme selection, inlined in <head> so neither surface
// flashes the wrong theme before hydration. Dark is the default on
// every device regardless of the system preference; an explicit user
// choice (the header toggle) still wins.
const THEME_BOOT = `(function(){
  try {
    var s = localStorage.getItem('spool-theme')
      || localStorage.getItem('spool.share-web.theme');
    var d = s === 'dark' || s === 'light' ? s === 'dark' : true;
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Spool' },
      { name: 'theme-color', content: '#000000' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg?v=3', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon-32x32.png?v=3', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: '/favicon-16x16.png?v=3', sizes: '16x16', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png?v=3' },
    ],
    scripts: [{ children: THEME_BOOT }],
  }),
  notFoundComponent: () => <Tombstone reason="not-found" />,
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

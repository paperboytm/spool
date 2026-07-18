import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
// flashes the wrong theme before hydration. Reads the unified key
// first, then the two keys the split sites used to write, then the
// system preference.
const THEME_BOOT = `(function(){
  try {
    var s = localStorage.getItem('spool-theme')
      || localStorage.getItem('spool.share-web.theme');
    var d = s === 'dark' || s === 'light'
      ? s === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  } catch (e) {}
})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Spool' },
      { name: 'theme-color', content: '#141410', media: '(prefers-color-scheme: dark)' },
      { name: 'theme-color', content: '#FAFAF8', media: '(prefers-color-scheme: light)' },
    ],
    links: [
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'icon', href: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { rel: 'icon', href: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
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
    <html lang="en">
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

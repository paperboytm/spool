// Prerendered at build time — legal pages are the one app-chrome
// surface we WANT indexable (Google's OAuth brand verification fetches
// the privacy URL), so they ship as static HTML like the marketing
// site.

import { createFileRoute } from '@tanstack/react-router'

import { Terms } from '../pages/Terms'

export const Route = createFileRoute('/terms')({
  head: () => ({ meta: [{ title: 'Terms · spool.pro' }] }),
  component: Terms,
})

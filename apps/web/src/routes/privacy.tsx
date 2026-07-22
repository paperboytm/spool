// Prerendered at build time — see terms.tsx for why the legal pages
// ship as static indexable HTML.

import { createFileRoute } from '@tanstack/react-router'

import { Privacy } from '../pages/Privacy'

export const Route = createFileRoute('/privacy')({
  head: () => ({ meta: [{ title: 'Privacy · spool.new' }] }),
  component: Privacy,
})

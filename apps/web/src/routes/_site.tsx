// Pathless layout for the marketing surface (home, daemon, docs, blog).
// Owns the landing design system CSS — the app surfaces (/s/*, /me, …)
// never load these styles, mirroring the pre-merge split between the
// landing site and share-web.

import { createFileRoute, Outlet } from '@tanstack/react-router'

import '../styles/global.css'
import '../styles/home.css'
import '../styles/docs.css'
import '../styles/blog.css'
import '../styles/daemon.css'

import SiteLayout from '../components/site/site-layout'

export const Route = createFileRoute('/_site')({
  component: () => (
    <SiteLayout>
      <Outlet />
    </SiteLayout>
  ),
})

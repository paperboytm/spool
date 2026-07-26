import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/@{$handle}')({
  ssr: false,
  component: OwnerRoute,
})

/**
 * Owner handles are a route namespace. The index child renders the Profile;
 * Project children render their own page through this outlet.
 */
function OwnerRoute() {
  return <Outlet />
}

import { createFileRoute } from '@tanstack/react-router'

import { nextSafe } from '../lib/route'
import { SignIn } from '../pages/SignIn'

export const Route = createFileRoute('/sign-in')({
  ssr: false,
  // Keep absent params absent (undefined) so the router doesn't
  // redirect bare /sign-in to a canonicalized URL. nextSafe runs at
  // render: it collapses anything that isn't a same-origin relative
  // path to '/' — open-redirect defense-in-depth, same as the server's
  // safeNext on the OAuth callback.
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search['next'] === 'string' ? search['next'] : undefined,
  }),
  component: SignInPage,
})

function SignInPage() {
  const { next } = Route.useSearch()
  return <SignIn next={nextSafe(next)} />
}

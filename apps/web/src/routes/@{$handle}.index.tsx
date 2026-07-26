// /@<handle> — public profile. Client-rendered like the old SPA (no OG
// surface for profiles yet); the handle is validated here so `/@bogus!!`
// renders the tombstone instead of issuing a guaranteed-404 fetch.

import { createFileRoute } from '@tanstack/react-router'

import { HANDLE_RE } from '../lib/route'
import { Profile, type ProfileTab } from '../pages/Profile'
import { Tombstone } from '../pages/Tombstone'

export const Route = createFileRoute('/@{$handle}/')({
  ssr: false,
  validateSearch: (value: Record<string, unknown>): { tab: ProfileTab } => ({
    tab:
      value['tab'] === 'stars' || value['tab'] === 'followers' || value['tab'] === 'following'
        ? value['tab']
        : 'overview',
  }),
  component: ProfilePage,
})

function ProfilePage() {
  const { handle } = Route.useParams()
  const { tab } = Route.useSearch()
  const normalized = handle.toLowerCase()
  if (!HANDLE_RE.test(normalized)) return <Tombstone reason="not-found" />
  return <Profile handle={normalized} tab={tab} />
}

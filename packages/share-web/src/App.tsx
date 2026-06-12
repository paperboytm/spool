import { useMemo } from 'react'

import { routeFor } from './lib/route'
import { Me } from './pages/Me'
import { Privacy } from './pages/Privacy'
import { Profile } from './pages/Profile'
import { Reader } from './pages/Reader'
import { SignIn } from './pages/SignIn'
import { Terms } from './pages/Terms'
import { Tombstone } from './pages/Tombstone'

export function App() {
  const route = useMemo(
    () => routeFor(window.location.pathname, window.location.search),
    [],
  )

  if (route.kind === 'reader') return <Reader id={route.id} />
  if (route.kind === 'profile') return <Profile handle={route.handle} />
  if (route.kind === 'me') return <Me />
  if (route.kind === 'sign-in') return <SignIn next={route.next} />
  if (route.kind === 'terms') return <Terms />
  if (route.kind === 'privacy') return <Privacy />
  return <Tombstone reason="not-found" />
}

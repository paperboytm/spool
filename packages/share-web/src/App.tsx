import { useMemo } from 'react'

import { routeFor } from './lib/route'
import { Me } from './pages/Me'
import { Profile } from './pages/Profile'
import { Reader } from './pages/Reader'
import { SignIn } from './pages/SignIn'
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
  return <Tombstone reason="not-found" />
}

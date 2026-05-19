import { useMemo } from 'react'

import { routeFor } from './lib/route'
import { Reader } from './pages/Reader'
import { Tombstone } from './pages/Tombstone'

export function App() {
  const route = useMemo(
    () => routeFor(window.location.pathname, window.location.search),
    [],
  )

  if (route.kind === 'reader') return <Reader id={route.id} />
  return <Tombstone reason="not-found" />
}

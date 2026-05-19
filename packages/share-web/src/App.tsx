import { useMemo } from 'react'

import { routeFor } from './lib/route'
import { Reader } from './pages/Reader'
import { Report } from './pages/Report'
import { Tombstone } from './pages/Tombstone'

export function App() {
  const route = useMemo(
    () => routeFor(window.location.pathname, window.location.search),
    [],
  )

  if (route.kind === 'reader') return <Reader id={route.id} />
  if (route.kind === 'report') return <Report initialId={route.id} />
  return <Tombstone reason="not-found" />
}

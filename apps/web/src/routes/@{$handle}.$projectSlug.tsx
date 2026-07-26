import { createFileRoute } from '@tanstack/react-router'

import { HANDLE_RE, PROJECT_SLUG_RE } from '../lib/route'
import { ProjectPage } from '../pages/Project'
import { Tombstone } from '../pages/Tombstone'

export const Route = createFileRoute('/@{$handle}/$projectSlug')({
  ssr: false,
  component: OwnerProjectRoute,
})

function OwnerProjectRoute() {
  const { handle, projectSlug } = Route.useParams()
  const normalizedHandle = handle.toLowerCase()
  const normalizedSlug = projectSlug.toLowerCase()
  if (!HANDLE_RE.test(normalizedHandle) || !PROJECT_SLUG_RE.test(normalizedSlug)) {
    return <Tombstone reason="not-found" />
  }
  return <ProjectPage handle={normalizedHandle} slug={normalizedSlug} />
}

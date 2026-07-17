import { createFileRoute } from '@tanstack/react-router'

import { CliAuth } from '../pages/cli-auth'

export const Route = createFileRoute('/cli-auth')({
  ssr: false,
  // Keep an absent code absent (undefined) so bare /cli-auth doesn't
  // redirect. The code is display material only (the page re-validates
  // against the backend); pass it through raw and let the page
  // normalize.
  validateSearch: (search: Record<string, unknown>) => ({
    code: typeof search['code'] === 'string' ? search['code'] : undefined,
  }),
  component: CliAuthPage,
})

function CliAuthPage() {
  const { code } = Route.useSearch()
  return <CliAuth code={code ?? null} />
}

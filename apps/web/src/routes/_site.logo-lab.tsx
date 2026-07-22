// Dev-only: candidate logo marks, side by side. Not linked from nav.
import { createFileRoute } from '@tanstack/react-router'

import LogoLab from '../components/site/logo-lab'

export const Route = createFileRoute('/_site/logo-lab')({
  head: () => ({ meta: [{ title: 'Logo lab · spool.new' }] }),
  component: LogoLab,
})

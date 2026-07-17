import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CLI_INSTALL_COMMAND, CliInstallDialog } from './cli-install-dialog'

const RESUME_COMMAND = 'spool resume claude_41eb99fe-e024-4fc6-9b87-4653ca6e7a69'

describe('CliInstallDialog', () => {
  it('stays out of the page when closed', () => {
    const html = renderToStaticMarkup(
      <CliInstallDialog open={false} resumeCommand={RESUME_COMMAND} onClose={() => undefined} />,
    )

    expect(html).toBe('')
  })

  it('guides visitors from installation to resuming the shared session', () => {
    const html = renderToStaticMarkup(
      <CliInstallDialog open resumeCommand={RESUME_COMMAND} onClose={() => undefined} />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Install the Spool CLI')
    expect(html).toContain(CLI_INSTALL_COMMAND)
    expect(html).toContain(RESUME_COMMAND)
    expect(html).toContain('Resume this session in its original agent.')
    expect(html).toContain('Close CLI installation guide')
  })
})

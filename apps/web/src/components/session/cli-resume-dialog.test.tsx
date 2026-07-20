import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vite-plus/test'

import { CliResumeDialog } from './cli-resume-dialog'

const RESUME_COMMAND = 'npx @spool-lab/cli resume claude_41eb99fe-e024-4fc6-9b87-4653ca6e7a69'

describe('CliResumeDialog', () => {
  it('stays out of the page when closed', () => {
    const html = renderToStaticMarkup(
      <CliResumeDialog open={false} resumeCommand={RESUME_COMMAND} onClose={() => undefined} />,
    )

    expect(html).toBe('')
  })

  it('guides visitors to resume with npx without requiring a global install', () => {
    const html = renderToStaticMarkup(
      <CliResumeDialog open resumeCommand={RESUME_COMMAND} onClose={() => undefined} />,
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
    expect(html).toContain('Resume with npx')
    expect(html).toContain(RESUME_COMMAND)
    expect(html).toContain('Resume this session in its original agent.')
    expect(html).toContain('No global install is required.')
    expect(html).toContain('npm install -g @spool-lab/cli')
    expect(html).toContain('Close CLI resume guide')
  })
})

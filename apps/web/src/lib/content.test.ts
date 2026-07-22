import { describe, expect, it } from 'vite-plus/test'

import { contentPage } from './content'

describe('public CLI documentation', () => {
  it('keeps the everyday Share path separate from advanced manual Summary input', () => {
    const quickStart = contentPage('/docs/quick-start')?.body ?? ''
    const publishing = contentPage('/docs/guides/publishing')?.body ?? ''
    const cliReference = contentPage('/docs/reference/cli')?.body ?? ''

    expect(quickStart).toContain('```bash\nspool\n```')
    expect(`${publishing}\n${cliReference}`).not.toContain('spool share --summary "..."')
    expect(`${publishing}\n${cliReference}`).toContain(
      '`--summary <markdown>` is an advanced manual or automation input',
    )
    expect(`${publishing}\n${cliReference}`).toContain('does not generate a Summary')
  })
})

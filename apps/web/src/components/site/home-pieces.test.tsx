import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vite-plus/test'

import { CLI_INSTALL_COMMAND, copyCommandText } from '../../lib/cli-command'
import { InstallCommandPill } from './home-pieces'

describe('homepage CLI installer', () => {
  it('copies the one-time curl installer instead of recommending npx', () => {
    const html = renderToStaticMarkup(<InstallCommandPill />)

    expect(CLI_INSTALL_COMMAND).toBe('curl -fsSL https://spool.new/install.sh | sh')
    expect(html).toContain('Copy CLI install command')
    expect(html).toContain('curl -fsSL https://spool.new/install.sh | sh')
    expect(html).not.toContain('npx @spool-lab/cli')
  })

  it('turns clipboard rejection into a visible failure state', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('clipboard denied')
    })

    await expect(copyCommandText(CLI_INSTALL_COMMAND, writeText)).resolves.toBe('failed')
    expect(writeText).toHaveBeenCalledWith(CLI_INSTALL_COMMAND)
  })
})
